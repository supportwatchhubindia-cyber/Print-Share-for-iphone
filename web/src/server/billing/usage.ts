import type { SubscriptionPlan } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../errors";
import { PLANS } from "@/lib/plans";
import type { UsageSummaryDTO } from "@/lib/types";

/** Usage is metered per calendar month (UTC). */
export function monthBounds(at = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { start, end };
}

export async function ensureSubscription(userId: string, plan: SubscriptionPlan = "FREE") {
  const existing = await prisma.subscription.findUnique({ where: { userId } });
  const { start, end } = monthBounds();
  if (existing) {
    if (existing.currentPeriodEnd.getTime() <= Date.now()) {
      return prisma.subscription.update({ where: { userId }, data: { currentPeriodStart: start, currentPeriodEnd: end } });
    }
    return existing;
  }
  const def = PLANS[plan];
  return prisma.subscription.create({
    data: {
      userId,
      plan,
      monthlyPageLimit: def.monthlyPageLimit,
      maxPrinters: def.maxPrinters,
      currentPeriodStart: start,
      currentPeriodEnd: end,
    },
  });
}

async function pagesUsed(userId: string, start: Date): Promise<number> {
  const agg = await prisma.usageRecord.aggregate({ where: { userId, periodStart: start }, _sum: { pages: true } });
  return agg._sum.pages ?? 0;
}

/** Pages already committed to jobs that have not finished yet. */
async function pagesReserved(userId: string): Promise<number> {
  const active = await prisma.printJob.findMany({
    where: { userId, isTest: false, status: { in: ["UPLOADED", "QUEUED", "PROCESSING", "PRINTING"] } },
    select: { pagesSelected: true, copies: true },
  });
  return active.reduce((sum, j) => sum + j.pagesSelected * j.copies, 0);
}

export async function assertQuota(userId: string, additionalPages: number, excludeJobPages = 0) {
  const sub = await ensureSubscription(userId);
  const { start } = monthBounds();
  const committed = (await pagesUsed(userId, start)) + (await pagesReserved(userId)) - excludeJobPages;
  if (committed + additionalPages > sub.monthlyPageLimit) {
    const remaining = Math.max(0, sub.monthlyPageLimit - committed);
    throw new ApiError(
      403,
      "QUOTA_EXCEEDED",
      `This job needs ${additionalPages} pages but your plan has ${remaining} left this month.`,
      { remaining, limit: sub.monthlyPageLimit },
    );
  }
}

export async function getUsageSummary(userId: string): Promise<UsageSummaryDTO> {
  const sub = await ensureSubscription(userId);
  const { start, end } = monthBounds();
  const since = new Date(Date.now() - 13 * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);

  const [used, jobs, completed, failed, active, recent] = await Promise.all([
    pagesUsed(userId, start),
    prisma.printJob.count({ where: { userId, createdAt: { gte: start, lt: end } } }),
    prisma.printJob.count({ where: { userId, status: "COMPLETED", createdAt: { gte: start, lt: end } } }),
    prisma.printJob.count({ where: { userId, status: "FAILED", createdAt: { gte: start, lt: end } } }),
    prisma.printJob.count({ where: { userId, status: { in: ["UPLOADED", "QUEUED", "PROCESSING", "PRINTING"] } } }),
    prisma.usageRecord.findMany({ where: { userId, createdAt: { gte: since } }, select: { pages: true, createdAt: true } }),
  ]);

  const daily: { date: string; pages: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const day = new Date(since.getTime() + i * 86_400_000);
    daily.push({ date: day.toISOString().slice(0, 10), pages: 0 });
  }
  for (const r of recent) {
    const key = r.createdAt.toISOString().slice(0, 10);
    const bucket = daily.find((d) => d.date === key);
    if (bucket) bucket.pages += r.pages;
  }

  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    pagesUsed: used,
    pageLimit: sub.monthlyPageLimit,
    jobsThisPeriod: jobs,
    completedJobs: completed,
    failedJobs: failed,
    activeJobs: active,
    daily,
  };
}
