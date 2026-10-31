import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { ApiError, conflict, notFound } from "../errors";
import { audit } from "../audit";
import { notifyBridge, notifyUser } from "../events";
import { ensureSubscription } from "../billing/usage";
import { isBridgeOnline, readDetectedPrinters, toPrinterDTO } from "../dto";
import { env } from "../env";
import { sha256Hex } from "../crypto";
import { documentKey, writeObject } from "../storage";
import { buildTestPagePdf } from "./test-page";
import { createPrintJob } from "./jobs";
import { mergeCapabilities, parseCapabilities } from "@/lib/printing/capabilities";
import { connectionFromPort, identifyModel } from "@/lib/printing/models";

export const registerPrinterSchema = z.object({
  bridgeId: z.string().min(1).max(64),
  systemName: z.string().min(1).max(256),
  name: z.string().trim().min(1, "Give the printer a name").max(80),
});

export async function listPrinters(userId: string) {
  const printers = await prisma.printer.findMany({
    where: { userId, removedAt: null },
    include: { bridge: true },
    orderBy: { createdAt: "asc" },
  });
  const counts = await prisma.printJob.groupBy({
    by: ["printerId"],
    where: { userId, status: { in: ["UPLOADED", "QUEUED", "PROCESSING", "PRINTING"] } },
    _count: { _all: true },
  });
  return printers.map((p) => toPrinterDTO(p, counts.find((c) => c.printerId === p.id)?._count._all ?? 0));
}

export async function getOwnedPrinter(userId: string, id: string) {
  const printer = await prisma.printer.findFirst({ where: { id, userId, removedAt: null }, include: { bridge: true } });
  if (!printer) throw notFound("Printer");
  return printer;
}

/** Registers a printer the user's bridge has reported. Capabilities come from model profile ∩ driver. */
export async function registerPrinter(userId: string, input: z.infer<typeof registerPrinterSchema>, req?: Request) {
  const bridge = await prisma.desktopBridge.findFirst({ where: { id: input.bridgeId, userId, revokedAt: null } });
  if (!bridge) throw notFound("Bridge");
  const detected = readDetectedPrinters(bridge.detectedPrinters).find((p) => p.systemName === input.systemName);
  if (!detected) {
    throw new ApiError(404, "PRINTER_NOT_DETECTED", "The bridge has not reported this printer. Select it in PrintShare Bridge and try again.");
  }
  const sub = await ensureSubscription(userId);
  const activeCount = await prisma.printer.count({ where: { userId, removedAt: null } });
  const existing = await prisma.printer.findUnique({ where: { bridgeId_systemName: { bridgeId: bridge.id, systemName: input.systemName } } });
  if (existing && !existing.removedAt) throw conflict("This printer is already registered.", "ALREADY_REGISTERED");
  if (activeCount >= sub.maxPrinters) {
    throw new ApiError(403, "PLAN_LIMIT", `Your plan allows ${sub.maxPrinters} printer${sub.maxPrinters === 1 ? "" : "s"}. Remove one or upgrade.`);
  }

  const model = identifyModel(detected.driverName, detected.systemName);
  const online = isBridgeOnline(bridge);
  const data = {
    name: input.name,
    modelKey: model.key,
    modelName: model.key === "GENERIC_WINDOWS" ? (detected.driverName ?? model.displayName) : model.displayName,
    systemName: detected.systemName,
    driverName: detected.driverName,
    portName: detected.portName,
    connection: connectionFromPort(detected.portName),
    state: online ? detected.state : ("OFFLINE" as const),
    stateMessage: detected.stateMessage,
    driverStatus: "INSTALLED" as const,
    capabilities: mergeCapabilities(model.profile, detected.capabilities) as unknown as Prisma.InputJsonValue,
    lastConnectedAt: online ? new Date() : null,
    removedAt: null,
  };
  const printer = existing
    ? await prisma.printer.update({ where: { id: existing.id }, data, include: { bridge: true } })
    : await prisma.printer.create({ data: { ...data, userId, bridgeId: bridge.id }, include: { bridge: true } });

  await audit({ action: "printer.register", actorType: "USER", actorId: userId, userId, targetType: "Printer", targetId: printer.id, req, metadata: { model: model.key, systemName: detected.systemName } });
  await notifyUser(userId, { type: "printer.updated", printerId: printer.id });
  return toPrinterDTO(printer);
}

export async function renamePrinter(userId: string, id: string, name: string) {
  const printer = await getOwnedPrinter(userId, id);
  const updated = await prisma.printer.update({ where: { id: printer.id }, data: { name }, include: { bridge: true } });
  await notifyUser(userId, { type: "printer.updated", printerId: id });
  return toPrinterDTO(updated);
}

/** Soft-removes a printer (job history is kept). Unstarted jobs are cancelled; jobs on the bridge get a cancel request. */
export async function removePrinter(userId: string, id: string, req?: Request) {
  const printer = await getOwnedPrinter(userId, id);
  const inflight = await prisma.$transaction(async (tx) => {
    await tx.printer.update({ where: { id: printer.id }, data: { removedAt: new Date() } });
    const pending = await tx.printJob.findMany({ where: { printerId: printer.id, status: { in: ["UPLOADED", "QUEUED"] } }, select: { id: true } });
    for (const j of pending) {
      await tx.printJob.update({ where: { id: j.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelRequestedAt: new Date() } });
      await tx.printJobEvent.create({ data: { printJobId: j.id, source: "SYSTEM", type: "cancelled", status: "CANCELLED", message: "Printer was removed." } });
    }
    const running = await tx.printJob.findMany({ where: { printerId: printer.id, status: { in: ["PROCESSING", "PRINTING"] } }, select: { id: true, claimedByBridgeId: true } });
    await tx.printJob.updateMany({ where: { id: { in: running.map((r) => r.id) } }, data: { cancelRequestedAt: new Date() } });
    return running;
  });
  for (const j of inflight) if (j.claimedByBridgeId) await notifyBridge(j.claimedByBridgeId, { type: "job.cancel", jobId: j.id });
  await audit({ action: "printer.remove", actorType: "USER", actorId: userId, userId, targetType: "Printer", targetId: printer.id, req });
  await notifyUser(userId, { type: "printer.updated", printerId: id });
}

/** Generates a diagnostic PDF and submits it through the normal print path (not counted against quota). */
export async function sendTestPage(userId: string, id: string, req?: Request) {
  const printer = await getOwnedPrinter(userId, id);
  if (!printer.bridge || printer.bridge.revokedAt) throw conflict("This printer has no active bridge.", "PRINTER_UNREACHABLE");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const caps = parseCapabilities(printer.capabilities);
  const paperSize = caps.paperSizes.includes("A4") ? "A4" : (caps.paperSizes[0] ?? "A4");
  const pdf = await buildTestPagePdf({
    printerName: printer.name,
    modelName: printer.modelName,
    bridgeName: printer.bridge.name,
    systemName: printer.systemName ?? "—",
    paperSize,
    requestedBy: user.email,
  });
  const doc = await prisma.document.create({
    data: {
      userId,
      originalName: "PrintShare test page.pdf",
      extension: "pdf",
      mimeType: "application/pdf",
      sizeBytes: pdf.length,
      storageKey: "",
      status: "PROCESSING",
      scanStatus: "SKIPPED",
      scanDetail: "Generated by PrintShare",
      expiresAt: new Date(Date.now() + env().DOCUMENT_TTL_HOURS * 3_600_000),
    },
  });
  const key = documentKey(userId, doc.id, "original.pdf");
  await writeObject(key, pdf, "application/pdf");
  await prisma.document.update({
    where: { id: doc.id },
    data: { status: "READY", storageKey: key, pdfStorageKey: key, pdfSizeBytes: pdf.length, pdfSha256: sha256Hex(pdf), pageCount: 1 },
  });
  return createPrintJob(
    userId,
    {
      documentId: doc.id,
      printerId: printer.id,
      settings: { copies: 1, pageRange: null, paperSize, orientation: "PORTRAIT", colorMode: "MONOCHROME", duplex: "SIMPLEX", quality: caps.qualities.includes("NORMAL") ? "NORMAL" : (caps.qualities[0] ?? "NORMAL"), scaleMode: "ACTUAL" },
    },
    { isTest: true, req },
  );
}

/** Asks the bridge to re-enumerate printers and refresh status immediately. */
export async function reconnectPrinter(userId: string, id: string, req?: Request) {
  const printer = await getOwnedPrinter(userId, id);
  if (!printer.bridge || printer.bridge.revokedAt) throw conflict("This printer has no active bridge.", "PRINTER_UNREACHABLE");
  if (!isBridgeOnline(printer.bridge)) {
    throw conflict(
      `${printer.bridge.name} is offline. Make sure the computer is on and PrintShare Bridge is running.`,
      "BRIDGE_OFFLINE",
    );
  }
  await notifyBridge(printer.bridge.id, { type: "printers.refresh" });
  await audit({ action: "printer.reconnect", actorType: "USER", actorId: userId, userId, targetType: "Printer", targetId: printer.id, req });
  return toPrinterDTO(printer);
}
