import type { DesktopBridge, Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "../db";
import { ApiError, clientIp, conflict, notFound, unauthorized } from "../errors";
import { normalizePairingCode, pairingCode, randomToken, safeEqual, sha256Hex } from "../crypto";
import { audit } from "../audit";
import { notifyBridge, notifyUser } from "../events";
import { BRIDGE_STALE_MS, isBridgeOnline, type StoredDetectedPrinter } from "../dto";
import { realtimeTransport } from "../env";
import { mergeCapabilities } from "@/lib/printing/capabilities";
import { connectionFromPort, identifyModel } from "@/lib/printing/models";
import { PRINTER_STATES, PRINTER_STATE_LABEL } from "@/lib/constants";

const PAIRING_TTL_MS = 10 * 60 * 1000;
export const HEARTBEAT_INTERVAL_SECONDS = 20;
export const POLL_INTERVAL_SECONDS = 15;

/**
 * How the bridge should receive work. With WebSockets it polls slowly as a fallback; on
 * serverless hosts it long-polls (server holds GET /api/bridge/jobs for up to 20 s).
 */
export function bridgeTiming() {
  const realtime = realtimeTransport() === "websocket";
  return {
    realtime,
    heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
    pollIntervalSeconds: realtime ? POLL_INTERVAL_SECONDS : 2,
    longPollSeconds: realtime ? 0 : 20,
  };
}

export async function createPairingCode(userId: string, req?: Request) {
  const active = await prisma.bridgePairingCode.count({ where: { userId, usedAt: null, expiresAt: { gt: new Date() } } });
  if (active >= 5) throw conflict("Too many active pairing codes. Use one or wait 10 minutes.", "TOO_MANY_CODES");
  const code = pairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  await prisma.bridgePairingCode.create({ data: { userId, codeHash: sha256Hex(code), expiresAt } });
  await audit({ action: "bridge.pairing_code_created", actorType: "USER", actorId: userId, userId, req });
  return { code, expiresAt };
}

export const registerBridgeSchema = z.object({
  pairingCode: z.string().min(8).max(16),
  name: z.string().trim().min(1).max(80),
  os: z.string().trim().max(120).optional(),
  appVersion: z.string().trim().max(40).optional(),
});

/** Exchanges a one-time pairing code for long-lived bridge credentials (returned once). */
export async function registerBridge(input: z.infer<typeof registerBridgeSchema>, req: NextRequest) {
  const codeHash = sha256Hex(normalizePairingCode(input.pairingCode));
  const secret = randomToken(32);
  const result = await prisma.$transaction(async (tx) => {
    const code = await tx.bridgePairingCode.findUnique({ where: { codeHash } });
    if (!code || code.usedAt || code.expiresAt.getTime() <= Date.now()) return null;
    const used = await tx.bridgePairingCode.updateMany({ where: { id: code.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) return null;
    const owner = await tx.user.findUnique({ where: { id: code.userId } });
    if (!owner || owner.status !== "ACTIVE") return null;
    const bridge = await tx.desktopBridge.create({
      data: {
        userId: code.userId,
        name: input.name,
        os: input.os,
        appVersion: input.appVersion,
        secretHash: sha256Hex(secret),
        status: "ONLINE",
        lastSeenAt: new Date(),
        lastIp: clientIp(req),
      },
    });
    await tx.bridgePairingCode.update({ where: { id: code.id }, data: { bridgeId: bridge.id } });
    return { bridge, owner };
  });
  if (!result) {
    await audit({ action: "bridge.pairing_failed", actorType: "SYSTEM", req });
    throw new ApiError(400, "INVALID_PAIRING_CODE", "This pairing code is invalid or has expired. Create a new one in the web dashboard.");
  }
  await audit({
    action: "bridge.registered",
    actorType: "BRIDGE",
    actorId: result.bridge.id,
    userId: result.owner.id,
    targetType: "DesktopBridge",
    targetId: result.bridge.id,
    req,
    metadata: { name: input.name, os: input.os ?? null, appVersion: input.appVersion ?? null },
  });
  await notifyUser(result.owner.id, { type: "bridge.updated", bridgeId: result.bridge.id });
  return {
    bridgeId: result.bridge.id,
    bridgeToken: `${result.bridge.id}.${secret}`,
    account: { name: result.owner.name, email: result.owner.email },
    ...bridgeTiming(),
  };
}

/** Verifies "Bearer <bridgeId>.<secret>". Used by HTTP routes and the WebSocket upgrade. */
export async function authenticateBridgeToken(authorization: string | null | undefined): Promise<DesktopBridge | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  const dot = token.indexOf(".");
  if (dot <= 0 || token.length > 300) return null;
  const id = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  const bridge = await prisma.desktopBridge.findUnique({ where: { id } });
  if (!bridge || bridge.revokedAt || bridge.status === "REVOKED") return null;
  if (!safeEqual(bridge.secretHash, sha256Hex(secret))) return null;
  const owner = await prisma.user.findUnique({ where: { id: bridge.userId }, select: { status: true } });
  if (owner?.status !== "ACTIVE") return null;
  return bridge;
}

export async function requireBridge(req: NextRequest): Promise<DesktopBridge> {
  const bridge = await authenticateBridgeToken(req.headers.get("authorization"));
  if (!bridge) throw unauthorized("Bridge credentials are invalid or have been revoked. Pair the bridge again.");
  return bridge;
}

const driverCapsSchema = z.object({
  supportsColor: z.boolean(),
  canDuplex: z.boolean(),
  paperSizes: z.array(z.string().max(40)).max(200),
  resolutionsDpi: z.array(z.number().int().min(0).max(10_000)).max(50),
  maxCopies: z.number().int().min(0).max(10_000),
});

export const heartbeatSchema = z.object({
  appVersion: z.string().max(40).optional(),
  os: z.string().max(120).optional(),
  paused: z.boolean().default(false),
  printers: z
    .array(
      z.object({
        systemName: z.string().min(1).max(256),
        driverName: z.string().max(256).nullable().optional(),
        portName: z.string().max(256).nullable().optional(),
        isDefault: z.boolean().default(false),
        state: z.enum(PRINTER_STATES),
        stateMessage: z.string().max(300).nullable().optional(),
        capabilities: driverCapsSchema.nullable().optional(),
      }),
    )
    .max(50),
});
export type HeartbeatInput = z.infer<typeof heartbeatSchema>;

export async function processHeartbeat(bridge: DesktopBridge, input: HeartbeatInput, req: NextRequest) {
  const now = new Date();
  const wasOnline = isBridgeOnline(bridge);
  const detected: StoredDetectedPrinter[] = input.printers.map((p) => ({
    systemName: p.systemName,
    driverName: p.driverName ?? null,
    portName: p.portName ?? null,
    isDefault: p.isDefault,
    state: p.state,
    stateMessage: p.stateMessage ?? null,
    capabilities: p.capabilities ?? null,
  }));

  await prisma.desktopBridge.update({
    where: { id: bridge.id },
    data: {
      status: input.paused ? "PAUSED" : "ONLINE",
      lastSeenAt: now,
      lastIp: clientIp(req),
      appVersion: input.appVersion ?? bridge.appVersion,
      os: input.os ?? bridge.os,
      detectedPrinters: detected as unknown as Prisma.InputJsonValue,
    },
  });

  const registered = await prisma.printer.findMany({ where: { bridgeId: bridge.id, removedAt: null } });
  let printersChanged = false;
  for (const printer of registered) {
    const match = detected.find((d) => d.systemName === printer.systemName);
    const model = identifyModel(match?.driverName ?? printer.driverName, printer.systemName);
    const next = match
      ? {
          state: match.state,
          stateMessage: match.stateMessage ?? (match.state === "READY" ? null : PRINTER_STATE_LABEL[match.state]),
          driverStatus: "INSTALLED" as const,
          driverName: match.driverName,
          portName: match.portName,
          connection: connectionFromPort(match.portName),
          capabilities: mergeCapabilities(model.profile, match.capabilities) as unknown as Prisma.InputJsonValue,
          ...(match.state !== "OFFLINE" ? { lastConnectedAt: now } : {}),
        }
      : {
          state: "OFFLINE" as const,
          stateMessage: `Not found on ${bridge.name}. Check that the printer is installed and shared in the bridge.`,
          driverStatus: "MISSING" as const,
        };
    const changed =
      printer.state !== next.state ||
      printer.stateMessage !== next.stateMessage ||
      printer.driverStatus !== next.driverStatus ||
      ("capabilities" in next && JSON.stringify(printer.capabilities) !== JSON.stringify(next.capabilities));
    if (changed || "lastConnectedAt" in next) {
      await prisma.printer.update({ where: { id: printer.id }, data: next });
    }
    if (changed) printersChanged = true;
  }

  const cancelJobs = await prisma.printJob.findMany({
    where: { claimedByBridgeId: bridge.id, status: { in: ["PROCESSING", "PRINTING"] }, cancelRequestedAt: { not: null } },
    select: { id: true },
  });

  if (!wasOnline || printersChanged || bridge.status !== (input.paused ? "PAUSED" : "ONLINE")) {
    await notifyUser(bridge.userId, { type: "bridge.updated", bridgeId: bridge.id });
    await notifyUser(bridge.userId, { type: "printer.updated", printerId: null });
  }
  if (!wasOnline) {
    await audit({ action: "bridge.online", actorType: "BRIDGE", actorId: bridge.id, userId: bridge.userId, targetType: "DesktopBridge", targetId: bridge.id, req });
  }

  return {
    serverTime: now.toISOString(),
    ...bridgeTiming(),
    cancelJobIds: cancelJobs.map((j) => j.id),
    printers: registered.map((p) => ({ id: p.id, systemName: p.systemName, name: p.name })),
  };
}

export async function getOwnedBridge(userId: string, id: string) {
  const bridge = await prisma.desktopBridge.findFirst({ where: { id, userId } });
  if (!bridge) throw notFound("Bridge");
  return bridge;
}

/** Revokes bridge credentials; its printers stay registered but become unreachable. */
export async function revokeBridge(userId: string, id: string, req?: Request, actorType: "USER" | "ADMIN" = "USER") {
  const bridge = actorType === "ADMIN" ? await prisma.desktopBridge.findUnique({ where: { id } }) : await getOwnedBridge(userId, id);
  if (!bridge) throw notFound("Bridge");
  await prisma.$transaction(async (tx) => {
    await tx.desktopBridge.update({ where: { id: bridge.id }, data: { status: "REVOKED", revokedAt: new Date() } });
    await tx.printer.updateMany({ where: { bridgeId: bridge.id }, data: { state: "OFFLINE", stateMessage: "Bridge was removed." } });
    const queued = await tx.printJob.findMany({ where: { printer: { bridgeId: bridge.id }, status: { in: ["UPLOADED", "QUEUED"] } }, select: { id: true } });
    for (const j of queued) {
      await tx.printJob.update({ where: { id: j.id }, data: { status: "FAILED", failedAt: new Date(), errorCode: "BRIDGE_REVOKED", errorMessage: "The bridge for this printer was removed." } });
      await tx.printJobEvent.create({ data: { printJobId: j.id, source: "SYSTEM", type: "failed", status: "FAILED", message: "The bridge for this printer was removed." } });
    }
  });
  await notifyBridge(bridge.id, { type: "bridge.revoked" });
  await notifyUser(bridge.userId, { type: "bridge.updated", bridgeId: bridge.id });
  await audit({ action: "bridge.revoked", actorType, actorId: userId, userId: bridge.userId, targetType: "DesktopBridge", targetId: bridge.id, req });
}

/** Marks bridges without a recent heartbeat as OFFLINE (run periodically). */
export async function markStaleBridgesOffline(now = Date.now()): Promise<number> {
  const stale = await prisma.desktopBridge.findMany({
    where: { status: { in: ["ONLINE", "PAUSED"] }, lastSeenAt: { lt: new Date(now - BRIDGE_STALE_MS) }, revokedAt: null },
    select: { id: true, userId: true, name: true },
  });
  for (const b of stale) {
    await prisma.desktopBridge.update({ where: { id: b.id }, data: { status: "OFFLINE" } });
    await prisma.printer.updateMany({
      where: { bridgeId: b.id, removedAt: null },
      data: { state: "OFFLINE", stateMessage: `${b.name} is offline.` },
    });
    await notifyUser(b.userId, { type: "bridge.updated", bridgeId: b.id });
    await notifyUser(b.userId, { type: "printer.updated", printerId: null });
  }
  return stale.length;
}
