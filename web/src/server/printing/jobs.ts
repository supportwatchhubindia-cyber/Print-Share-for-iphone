import type { DesktopBridge, JobEventSource, Prisma, PrintJob, PrintJobStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { ApiError, conflict, notFound } from "../errors";
import { audit } from "../audit";
import { notifyBridge, notifyUser } from "../events";
import { signToken } from "../crypto";
import { assertQuota, monthBounds } from "../billing/usage";
import { jobInclude, toJobDTO } from "../dto";
import { parseCapabilities } from "@/lib/printing/capabilities";
import { parsePageRange } from "@/lib/printing/page-range";
import { printSettingsSchema, validateSettings } from "@/lib/printing/settings";
import { canTransition } from "@/lib/printing/transitions";
import { PRINT_QUALITY_INFO, PRINTER_STATES } from "@/lib/constants";

export const ACTIVE: PrintJobStatus[] = ["UPLOADED", "QUEUED", "PROCESSING", "PRINTING"];
export const DOWNLOAD_TOKEN_TTL_SECONDS = 10 * 60;

export const createJobSchema = z.object({
  documentId: z.string().min(1).max(64),
  printerId: z.string().min(1).max(64),
  settings: printSettingsSchema,
});
export type CreateJobInput = z.infer<typeof createJobSchema>;

async function addEvent(
  tx: Prisma.TransactionClient,
  printJobId: string,
  source: JobEventSource,
  type: string,
  message: string,
  status?: PrintJobStatus | null,
  metadata?: Prisma.InputJsonValue,
) {
  await tx.printJobEvent.create({ data: { printJobId, source, type, message, status: status ?? null, metadata } });
}

export async function getOwnedJob(userId: string, id: string) {
  const job = await prisma.printJob.findFirst({ where: { id, userId }, include: jobInclude });
  if (!job) throw notFound("Print job");
  return job;
}

export async function createPrintJob(userId: string, input: CreateJobInput, opts: { isTest?: boolean; req?: Request } = {}) {
  const doc = await prisma.document.findFirst({ where: { id: input.documentId, userId, deletedAt: null } });
  if (!doc) throw notFound("Document");
  if (doc.status !== "READY" || !doc.pageCount) {
    throw conflict(
      doc.status === "EXPIRED" ? "This document has expired. Upload it again." : "This document is not ready to print.",
      "DOCUMENT_NOT_READY",
    );
  }
  if (doc.expiresAt.getTime() <= Date.now()) throw conflict("This document has expired. Upload it again.", "DOCUMENT_NOT_READY");

  const printer = await prisma.printer.findFirst({
    where: { id: input.printerId, userId, removedAt: null },
    include: { bridge: true },
  });
  if (!printer) throw notFound("Printer");
  if (!printer.bridge || printer.bridge.revokedAt) {
    throw conflict("This printer is not attached to an active Windows bridge.", "PRINTER_UNREACHABLE");
  }

  const caps = parseCapabilities(printer.capabilities);
  const check = validateSettings(input.settings, caps, doc.pageCount);
  if (!check.ok) {
    throw new ApiError(400, "VALIDATION_ERROR", "Some print settings are not supported by this printer.", { fields: check.fields });
  }
  const s = input.settings;
  const pagesSelected = check.pages.length;
  if (!opts.isTest) await assertQuota(userId, pagesSelected * s.copies);

  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.printJob.create({
      data: {
        userId,
        printerId: printer.id,
        documentId: doc.id,
        documentName: doc.originalName,
        documentPages: doc.pageCount!,
        status: "QUEUED",
        copies: s.copies,
        pageRange: check.normalizedRange,
        pagesSelected,
        paperSize: s.paperSize,
        orientation: s.orientation,
        colorMode: s.colorMode,
        duplex: s.duplex,
        quality: s.quality,
        scaleMode: s.scaleMode,
        isTest: !!opts.isTest,
      },
      include: jobInclude,
    });
    await addEvent(tx, created.id, "USER", "submitted", opts.isTest ? "Test page requested" : "Print job submitted", "UPLOADED");
    await addEvent(tx, created.id, "SYSTEM", "queued", `Queued for ${printer.name} via ${printer.bridge!.name}`, "QUEUED");
    return created;
  });

  await notifyBridge(printer.bridge.id, { type: "job.available" });
  await notifyUser(userId, { type: "job.updated", jobId: job.id, status: job.status });
  await audit({
    action: opts.isTest ? "printer.test_print" : "print_job.create",
    actorType: "USER",
    actorId: userId,
    userId,
    targetType: "PrintJob",
    targetId: job.id,
    req: opts.req,
    metadata: { printerId: printer.id, pages: pagesSelected, copies: s.copies },
  });
  return job;
}

export async function cancelPrintJob(userId: string, id: string, req?: Request) {
  const job = await getOwnedJob(userId, id);
  if (!ACTIVE.includes(job.status)) throw conflict("This job has already finished.", "JOB_FINISHED");
  if (job.cancelRequestedAt) return job;

  if (job.status === "UPLOADED" || job.status === "QUEUED") {
    const res = await prisma.$transaction(async (tx) => {
      const r = await tx.printJob.updateMany({
        where: { id: job.id, status: job.status },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelRequestedAt: new Date() },
      });
      if (r.count === 1) await addEvent(tx, job.id, "USER", "cancelled", "Cancelled before printing started", "CANCELLED");
      return r.count;
    });
    if (res === 0) return cancelPrintJob(userId, id, req); // a bridge claimed it in the meantime
  } else {
    // Already on the bridge: ask it to remove the job from the Windows queue; it reports CANCELLED.
    await prisma.$transaction(async (tx) => {
      await tx.printJob.update({ where: { id: job.id }, data: { cancelRequestedAt: new Date() } });
      await addEvent(tx, job.id, "USER", "cancel_requested", "Cancellation requested — waiting for the bridge to confirm");
    });
    if (job.claimedByBridgeId) await notifyBridge(job.claimedByBridgeId, { type: "job.cancel", jobId: job.id });
  }
  await audit({ action: "print_job.cancel", actorType: "USER", actorId: userId, userId, targetType: "PrintJob", targetId: job.id, req });
  const updated = await getOwnedJob(userId, id);
  await notifyUser(userId, { type: "job.updated", jobId: updated.id, status: updated.status });
  return updated;
}

export async function retryPrintJob(userId: string, id: string, req?: Request) {
  const job = await getOwnedJob(userId, id);
  if (job.status !== "FAILED" && job.status !== "CANCELLED") throw conflict("Only failed or cancelled jobs can be retried.", "NOT_RETRYABLE");
  const doc = job.documentId ? await prisma.document.findFirst({ where: { id: job.documentId, userId } }) : null;
  if (!doc || doc.status !== "READY" || doc.deletedAt || doc.expiresAt.getTime() <= Date.now()) {
    throw conflict("The document for this job is no longer available. Upload it again.", "DOCUMENT_NOT_READY");
  }
  const printer = await prisma.printer.findFirst({ where: { id: job.printerId, userId, removedAt: null }, include: { bridge: true } });
  if (!printer?.bridge || printer.bridge.revokedAt) throw conflict("This printer is no longer available.", "PRINTER_UNREACHABLE");
  if (!job.isTest) await assertQuota(userId, job.pagesSelected * job.copies);

  await prisma.$transaction(async (tx) => {
    const r = await tx.printJob.updateMany({
      where: { id: job.id, status: job.status, attempt: job.attempt },
      data: {
        status: "QUEUED",
        attempt: { increment: 1 },
        claimedByBridgeId: null,
        claimedAt: null,
        spoolJobId: null,
        pagesPrinted: null,
        printerAlert: null,
        errorCode: null,
        errorMessage: null,
        cancelRequestedAt: null,
        printingAt: null,
        failedAt: null,
        cancelledAt: null,
      },
    });
    if (r.count !== 1) throw conflict("The job changed while retrying. Refresh and try again.");
    await addEvent(tx, job.id, "USER", "retry", `Retry requested (attempt ${job.attempt + 1})`, "QUEUED");
  });
  await notifyBridge(printer.bridge.id, { type: "job.available" });
  await audit({ action: "print_job.retry", actorType: "USER", actorId: userId, userId, targetType: "PrintJob", targetId: job.id, req });
  const updated = await getOwnedJob(userId, id);
  await notifyUser(userId, { type: "job.updated", jobId: updated.id, status: updated.status });
  return updated;
}

// ---------------------------------------------------------------------------
// Bridge side
// ---------------------------------------------------------------------------

export type BridgeJobPayload = {
  id: string;
  jobNumber: number;
  attempt: number;
  status: PrintJobStatus;
  printerId: string;
  printerSystemName: string;
  documentName: string;
  cancelRequested: boolean;
  spoolJobId: number | null;
  document: { sha256: string; sizeBytes: number; pageCount: number; downloadUrl: string };
  settings: {
    copies: number;
    pages: number[];
    paperSize: string;
    orientation: string;
    colorMode: string;
    duplex: string;
    quality: string;
    dpi: number;
    scaleMode: string;
  };
};

type ClaimableJob = PrintJob & {
  printer: { id: string; systemName: string | null };
  document: { pdfSha256: string | null; pdfSizeBytes: number | null; pageCount: number | null } | null;
};

function toBridgePayload(job: ClaimableJob, bridgeId: string): BridgeJobPayload | null {
  if (!job.document?.pdfSha256 || !job.document.pdfSizeBytes || !job.printer.systemName) return null;
  const range = parsePageRange(job.pageRange, job.documentPages);
  const token = signToken("bridge-doc", { j: job.id, b: bridgeId, a: job.attempt }, DOWNLOAD_TOKEN_TTL_SECONDS);
  return {
    id: job.id,
    jobNumber: job.jobNumber,
    attempt: job.attempt,
    status: job.status,
    printerId: job.printer.id,
    printerSystemName: job.printer.systemName,
    documentName: job.documentName,
    cancelRequested: !!job.cancelRequestedAt,
    spoolJobId: job.spoolJobId,
    document: {
      sha256: job.document.pdfSha256,
      sizeBytes: job.document.pdfSizeBytes,
      pageCount: job.documentPages,
      downloadUrl: `/api/bridge/jobs/${job.id}/document?token=${encodeURIComponent(token)}`,
    },
    settings: {
      copies: job.copies,
      pages: range.ok ? range.pages : [],
      paperSize: job.paperSize,
      orientation: job.orientation,
      colorMode: job.colorMode,
      duplex: job.duplex,
      quality: job.quality,
      dpi: PRINT_QUALITY_INFO[job.quality].dpi,
      scaleMode: job.scaleMode,
    },
  };
}

const claimInclude = {
  printer: { select: { id: true, systemName: true } },
  document: { select: { pdfSha256: true, pdfSizeBytes: true, pageCount: true } },
} as const;

/**
 * Long-poll support for serverless deployments (no WebSocket push): waits up to `waitSeconds`
 * until a QUEUED job exists for one of the bridge's ready printers, or one of its in-flight jobs
 * has a cancel request. Returns early if the client disconnects.
 */
export async function waitForBridgeWork(bridge: DesktopBridge, readyPrinterIds: string[], waitSeconds: number, signal?: AbortSignal) {
  const deadline = Date.now() + Math.min(Math.max(waitSeconds, 0), 25) * 1000;
  const printerIds = readyPrinterIds.length
    ? (await prisma.printer.findMany({ where: { id: { in: readyPrinterIds }, bridgeId: bridge.id, removedAt: null }, select: { id: true } })).map((p) => p.id)
    : [];
  while (Date.now() < deadline && !signal?.aborted) {
    const pending = await prisma.printJob.count({
      where: {
        OR: [
          ...(printerIds.length && bridge.status !== "PAUSED" ? [{ status: "QUEUED" as const, printerId: { in: printerIds } }] : []),
          { claimedByBridgeId: bridge.id, status: { in: ["PROCESSING", "PRINTING"] }, cancelRequestedAt: { not: null } },
        ],
      },
    });
    if (pending > 0) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * Returns this bridge's in-flight jobs (for crash recovery) plus newly claimed QUEUED
 * jobs for printers the bridge says are ready. Claims are atomic (status-guarded update),
 * so a job is handed to exactly one poll.
 */
export async function claimJobsForBridge(bridge: DesktopBridge, readyPrinterIds: string[], max = 3): Promise<BridgeJobPayload[]> {
  const inflight = await prisma.printJob.findMany({
    where: { claimedByBridgeId: bridge.id, status: { in: ["PROCESSING", "PRINTING"] } },
    include: claimInclude,
    orderBy: { claimedAt: "asc" },
  });

  const claimed: ClaimableJob[] = [];
  if (bridge.status !== "PAUSED" && readyPrinterIds.length > 0) {
    const printers = await prisma.printer.findMany({
      where: { id: { in: readyPrinterIds }, bridgeId: bridge.id, removedAt: null },
      select: { id: true },
    });
    const candidates = printers.length
      ? await prisma.printJob.findMany({
          where: { printerId: { in: printers.map((p) => p.id) }, status: "QUEUED" },
          orderBy: { createdAt: "asc" },
          take: max,
          select: { id: true, userId: true },
        })
      : [];
    for (const c of candidates) {
      const won = await prisma.$transaction(async (tx) => {
        const r = await tx.printJob.updateMany({
          where: { id: c.id, status: "QUEUED" },
          data: { status: "PROCESSING", claimedByBridgeId: bridge.id, claimedAt: new Date() },
        });
        if (r.count !== 1) return null;
        await addEvent(tx, c.id, "SYSTEM", "claimed", `Picked up by ${bridge.name}`, "PROCESSING");
        return tx.printJob.findUnique({ where: { id: c.id }, include: claimInclude });
      });
      if (won) {
        claimed.push(won);
        await notifyUser(c.userId, { type: "job.updated", jobId: c.id, status: "PROCESSING" });
      }
    }
  }
  return [...inflight, ...claimed].map((j) => toBridgePayload(j, bridge.id)).filter((j): j is BridgeJobPayload => !!j);
}

export const bridgeStatusSchema = z.object({
  attempt: z.number().int().min(1),
  status: z.enum(["QUEUED", "PROCESSING", "PRINTING", "COMPLETED", "FAILED", "CANCELLED"]),
  message: z.string().max(500).optional(),
  errorCode: z.string().max(64).optional(),
  spoolJobId: z.number().int().min(0).optional(),
  pagesPrinted: z.number().int().min(0).max(100_000).optional(),
  printerAlert: z.string().max(300).nullable().optional(),
  printerState: z.enum(PRINTER_STATES).optional(),
  confirmation: z
    .object({
      source: z.enum(["SPOOLER_PRINTED_FLAG", "SPOOLER_COMPLETE_FLAG", "SPOOLER_QUEUE_DRAINED"]),
      detail: z.string().max(500).optional(),
    })
    .optional(),
});
export type BridgeStatusInput = z.infer<typeof bridgeStatusSchema>;

const CONFIRMATION_TEXT = {
  SPOOLER_PRINTED_FLAG: "Windows reported the job as printed",
  SPOOLER_COMPLETE_FLAG: "Windows reported the job as fully sent to the printer",
  SPOOLER_QUEUE_DRAINED: "Windows finished sending the job to the printer and removed it from the queue",
} as const;

/** Applies a status report from the bridge. Idempotent for repeated terminal reports. */
export async function applyBridgeStatus(bridge: DesktopBridge, jobId: string, input: BridgeStatusInput) {
  const job = await prisma.printJob.findFirst({ where: { id: jobId, claimedByBridgeId: bridge.id } });
  if (!job) throw notFound("Print job");
  if (input.attempt !== job.attempt) {
    throw conflict("This report is for an older attempt of the job.", "STALE_ATTEMPT", { status: job.status, attempt: job.attempt });
  }
  const cancelRequested = !!job.cancelRequestedAt;
  if (job.status === input.status && (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED")) {
    return { status: job.status, cancelRequested };
  }
  if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
    throw conflict("This job has already finished.", "JOB_FINISHED", { status: job.status });
  }

  const sameStatus = job.status === input.status;
  if (!sameStatus && !canTransition(job.status, input.status)) {
    throw conflict(`Cannot move a job from ${job.status} to ${input.status}.`, "INVALID_TRANSITION", { status: job.status });
  }

  const now = new Date();
  const data: Prisma.PrintJobUncheckedUpdateManyInput = { status: input.status };
  let eventType = "status";
  let message = input.message ?? "";
  let metadata: Prisma.InputJsonValue | undefined;

  switch (input.status) {
    case "QUEUED":
      if (job.status !== "PROCESSING" || job.spoolJobId != null) {
        throw conflict("A job can only be released before it reaches the Windows spooler.", "INVALID_TRANSITION");
      }
      Object.assign(data, { claimedByBridgeId: null, claimedAt: null });
      eventType = "released";
      message ||= "Released by the bridge; will retry when the printer is ready";
      break;
    case "PROCESSING":
      eventType = "progress";
      break;
    case "PRINTING":
      if (input.spoolJobId != null) data.spoolJobId = input.spoolJobId;
      if (input.pagesPrinted != null) data.pagesPrinted = input.pagesPrinted;
      if (input.printerAlert !== undefined) data.printerAlert = input.printerAlert;
      if (!sameStatus) {
        data.printingAt = now;
        eventType = "spooled";
        message ||= `Sent to the Windows print queue${input.spoolJobId != null ? ` (spooler job ${input.spoolJobId})` : ""}`;
      } else if (input.printerAlert && input.printerAlert !== job.printerAlert) {
        eventType = "printer_alert";
        message = input.printerAlert;
      } else if (input.printerAlert === null && job.printerAlert) {
        eventType = "printer_alert_cleared";
        message = "Printer recovered; printing continues";
      } else {
        eventType = "progress";
      }
      break;
    case "COMPLETED": {
      if (!input.confirmation) {
        throw new ApiError(400, "CONFIRMATION_REQUIRED", "COMPLETED must include spooler confirmation.");
      }
      const spoolJobId = input.spoolJobId ?? job.spoolJobId;
      if (spoolJobId == null) throw new ApiError(400, "CONFIRMATION_REQUIRED", "COMPLETED requires the spooler job id.");
      Object.assign(data, { spoolJobId, completedAt: now, printerAlert: null });
      if (input.pagesPrinted != null) data.pagesPrinted = input.pagesPrinted;
      eventType = "completed";
      message = CONFIRMATION_TEXT[input.confirmation.source];
      metadata = { confirmation: input.confirmation.source, detail: input.confirmation.detail ?? null, spoolJobId };
      break;
    }
    case "FAILED":
      Object.assign(data, {
        failedAt: now,
        errorCode: input.errorCode ?? "PRINT_FAILED",
        errorMessage: input.message ?? "The printer could not print this job.",
      });
      eventType = "failed";
      message = input.message ?? "Printing failed";
      metadata = { errorCode: input.errorCode ?? "PRINT_FAILED" };
      break;
    case "CANCELLED":
      Object.assign(data, { cancelledAt: now, printerAlert: null });
      eventType = "cancelled";
      message ||= cancelRequested ? "Cancelled and removed from the Windows print queue" : "Removed from the Windows print queue";
      break;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.printJob.updateMany({ where: { id: job.id, status: job.status, attempt: job.attempt }, data });
    if (r.count !== 1) throw conflict("The job changed concurrently; please resend.", "CONCURRENT_UPDATE");
    if (message) await addEvent(tx, job.id, "BRIDGE", eventType, message, sameStatus ? null : input.status, metadata);
    if (input.status === "COMPLETED" && !job.isTest) {
      const pages = job.pagesSelected * job.copies;
      await tx.usageRecord.upsert({
        where: { printJobId: job.id },
        create: { userId: job.userId, printJobId: job.id, pages, sheets: pages, periodStart: monthBounds(now).start },
        update: {},
      });
    }
    if (input.printerState) {
      await tx.printer.update({ where: { id: job.printerId }, data: { state: input.printerState } });
    }
    return tx.printJob.findUniqueOrThrow({ where: { id: job.id }, include: jobInclude });
  });

  await notifyUser(job.userId, { type: "job.updated", jobId: job.id, status: updated.status });
  if (input.printerState) await notifyUser(job.userId, { type: "printer.updated", printerId: job.printerId });
  if (updated.status !== job.status && (updated.status === "COMPLETED" || updated.status === "FAILED")) {
    await audit({
      action: `print_job.${updated.status.toLowerCase()}`,
      actorType: "BRIDGE",
      actorId: bridge.id,
      userId: job.userId,
      targetType: "PrintJob",
      targetId: job.id,
      metadata: metadata ?? {},
    });
  }
  return { status: updated.status, cancelRequested: !!updated.cancelRequestedAt, job: toJobDTO(updated) };
}

/** Bridge download authorisation: valid signed token bound to job, bridge and attempt. */
export async function jobForDownload(bridge: DesktopBridge, jobId: string, claims: Record<string, string | number>) {
  if (claims.j !== jobId || claims.b !== bridge.id) return null;
  const job = await prisma.printJob.findFirst({
    where: { id: jobId, claimedByBridgeId: bridge.id, status: { in: ["PROCESSING", "PRINTING"] } },
    include: { document: true },
  });
  if (!job || job.attempt !== claims.a || !job.document?.pdfStorageKey || job.document.deletedAt) return null;
  return job;
}
