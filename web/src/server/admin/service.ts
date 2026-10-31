import { z } from "zod";
import { prisma } from "../db";
import { env, realtimeTransport } from "../env";
import { conflict, notFound } from "../errors";
import { audit } from "../audit";
import { storageHealth } from "../storage";
import { officeConverter } from "../documents/convert";
import { clamdPing } from "../documents/scan";
import { BRIDGE_STALE_MS, isBridgeOnline, toPrinterDTO } from "../dto";
import { ensureSubscription } from "../billing/usage";
import { PLANS } from "@/lib/plans";
import { SUBSCRIPTION_PLANS } from "@/lib/constants";

export async function getAdminStats() {
  const onlineSince = new Date(Date.now() - BRIDGE_STALE_MS);
  const dayAgo = new Date(Date.now() - 86_400_000);
  const [users, printers, activeBridges, totalBridges, jobs, failed, completed, jobs24h, docAgg, docsStored, plans] = await Promise.all([
    prisma.user.count(),
    prisma.printer.count({ where: { removedAt: null } }),
    prisma.desktopBridge.count({ where: { status: { in: ["ONLINE", "PAUSED"] }, lastSeenAt: { gte: onlineSince }, revokedAt: null } }),
    prisma.desktopBridge.count({ where: { revokedAt: null } }),
    prisma.printJob.count(),
    prisma.printJob.count({ where: { status: "FAILED" } }),
    prisma.printJob.count({ where: { status: "COMPLETED" } }),
    prisma.printJob.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.document.aggregate({ where: { status: { in: ["READY", "PROCESSING"] } }, _sum: { sizeBytes: true, pdfSizeBytes: true } }),
    prisma.document.count({ where: { status: { in: ["READY", "PROCESSING"] } } }),
    prisma.subscription.groupBy({ by: ["plan"], _count: { _all: true } }),
  ]);
  return {
    users,
    printers,
    activeBridges,
    totalBridges,
    jobs,
    failedJobs: failed,
    completedJobs: completed,
    jobsLast24h: jobs24h,
    documentsStored: docsStored,
    storageBytes: (docAgg._sum.sizeBytes ?? 0) + (docAgg._sum.pdfSizeBytes ?? 0),
    plans: Object.fromEntries(SUBSCRIPTION_PLANS.map((p) => [p, plans.find((x) => x.plan === p)?._count._all ?? 0])),
  };
}

export async function listUsers(query: string | null, take = 50) {
  const users = await prisma.user.findMany({
    where: query ? { OR: [{ email: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }] } : {},
    include: { subscription: true, _count: { select: { printers: { where: { removedAt: null } }, printJobs: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    plan: u.subscription?.plan ?? "FREE",
    printers: u._count.printers,
    jobs: u._count.printJobs,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  }));
}

export const adminUpdateUserSchema = z.object({
  role: z.enum(["USER", "ADMIN"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  plan: z.enum(SUBSCRIPTION_PLANS).optional(),
});

export async function updateUser(adminId: string, userId: string, input: z.infer<typeof adminUpdateUserSchema>, req?: Request) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User");
  if (adminId === userId && (input.role === "USER" || input.status === "SUSPENDED")) {
    throw conflict("You cannot demote or suspend your own account.", "SELF_LOCKOUT");
  }
  await prisma.$transaction(async (tx) => {
    if (input.role || input.status) {
      await tx.user.update({ where: { id: userId }, data: { role: input.role, status: input.status } });
    }
    if (input.status === "SUSPENDED") {
      await tx.deviceSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
  });
  if (input.plan) {
    await ensureSubscription(userId);
    const def = PLANS[input.plan];
    await prisma.subscription.update({
      where: { userId },
      data: { plan: input.plan, monthlyPageLimit: def.monthlyPageLimit, maxPrinters: def.maxPrinters, status: "ACTIVE" },
    });
  }
  await audit({ action: "admin.user_update", actorType: "ADMIN", actorId: adminId, userId, targetType: "User", targetId: userId, req, metadata: input });
}

export async function listAllPrinters(take = 100) {
  const printers = await prisma.printer.findMany({
    where: { removedAt: null },
    include: { bridge: true, user: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
  return printers.map((p) => ({ ...toPrinterDTO(p), ownerEmail: p.user.email }));
}

export async function listAllBridges(take = 100) {
  const bridges = await prisma.desktopBridge.findMany({
    where: { revokedAt: null },
    include: { user: { select: { email: true } }, _count: { select: { printers: { where: { removedAt: null } } } } },
    orderBy: { lastSeenAt: { sort: "desc", nulls: "last" } },
    take,
  });
  return bridges.map((b) => ({
    id: b.id,
    name: b.name,
    ownerEmail: b.user.email,
    os: b.os,
    appVersion: b.appVersion,
    online: isBridgeOnline(b),
    status: b.status,
    lastSeenAt: b.lastSeenAt?.toISOString() ?? null,
    lastIp: b.lastIp,
    printers: b._count.printers,
  }));
}

export async function listAuditLogs(take = 100) {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take, include: { user: { select: { email: true } } } });
  return logs.map((l) => ({
    id: l.id,
    action: l.action,
    actorType: l.actorType,
    userEmail: l.user?.email ?? null,
    targetType: l.targetType,
    targetId: l.targetId,
    ipAddress: l.ipAddress,
    createdAt: l.createdAt.toISOString(),
  }));
}

type HealthCheck = { name: string; status: "ok" | "warn" | "error"; detail: string };

export async function getSystemHealth() {
  const checks: HealthCheck[] = [];
  const t0 = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: "Database", status: "ok", detail: `PostgreSQL responded in ${Math.round(performance.now() - t0)} ms` });
  } catch (err) {
    checks.push({ name: "Database", status: "error", detail: (err as Error).message.slice(0, 200) });
  }

  const storage = await storageHealth();
  checks.push({ name: "File storage", status: storage.ok ? "ok" : "error", detail: storage.detail });

  const office = officeConverter();
  checks.push({
    name: "Office conversion",
    status: office ? "ok" : "warn",
    detail: office ?? "No converter — set GOTENBERG_URL or install LibreOffice; DOCX/XLSX/PPTX uploads are rejected",
  });

  const { CLAMAV_HOST, CLAMAV_PORT, MALWARE_SCAN_REQUIRED } = env();
  if (CLAMAV_HOST) {
    const ok = await clamdPing(CLAMAV_HOST, CLAMAV_PORT);
    checks.push({ name: "Malware scanner", status: ok ? "ok" : "error", detail: ok ? `clamd at ${CLAMAV_HOST}:${CLAMAV_PORT}` : `clamd at ${CLAMAV_HOST}:${CLAMAV_PORT} is unreachable` });
  } else {
    checks.push({ name: "Malware scanner", status: MALWARE_SCAN_REQUIRED ? "error" : "warn", detail: "Not configured (set CLAMAV_HOST)" });
  }

  const stuck = await prisma.printJob.count({ where: { status: { in: ["PROCESSING", "PRINTING"] }, updatedAt: { lt: new Date(Date.now() - 30 * 60_000) } } });
  checks.push({ name: "Print pipeline", status: stuck ? "warn" : "ok", detail: stuck ? `${stuck} job(s) with no progress for 30+ minutes` : "No stalled jobs" });

  const realtime = (globalThis as Record<string, unknown>).__printshareRealtime as { browsers: number; bridges: number; listening: boolean } | undefined;
  checks.push(
    realtimeTransport() === "poll"
      ? { name: "Realtime", status: "ok", detail: "Polling mode (serverless): browsers auto-refresh, bridges long-poll for jobs" }
      : {
          name: "Realtime",
          status: realtime?.listening ? "ok" : "warn",
          detail: realtime ? `${realtime.browsers} browser and ${realtime.bridges} bridge connection(s)` : "WebSocket server not attached (start with server.ts)",
        },
  );

  const mem = process.memoryUsage();
  return {
    checks,
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
    },
  };
}
