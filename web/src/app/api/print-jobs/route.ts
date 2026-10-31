import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { api, json, readJson } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { createJobSchema, createPrintJob } from "@/server/printing/jobs";
import { jobInclude, toJobDTO } from "@/server/dto";
import { PRINT_JOB_STATUSES, type PrintJobStatus } from "@/lib/constants";
import type { Paginated, PrintJobDTO } from "@/lib/types";

export const GET = api(async (req) => {
  const { user } = await requireUser(req);
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 25) || 25));
  const cursor = url.searchParams.get("cursor");
  const statuses = (url.searchParams.get("status") ?? "")
    .split(",")
    .filter((s): s is PrintJobStatus => (PRINT_JOB_STATUSES as readonly string[]).includes(s));
  const printerId = url.searchParams.get("printerId");
  const q = url.searchParams.get("q")?.trim();

  const where: Prisma.PrintJobWhereInput = {
    userId: user.id,
    ...(statuses.length ? { status: { in: statuses } } : {}),
    ...(printerId ? { printerId } : {}),
    ...(q ? { documentName: { contains: q, mode: "insensitive" } } : {}),
  };
  const rows = await prisma.printJob.findMany({
    where,
    include: jobInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const body: Paginated<PrintJobDTO> = {
    items: rows.slice(0, limit).map(toJobDTO),
    nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
  };
  return json(body);
});

export const POST = api(async (req) => {
  const { user } = await requireUser(req);
  enforceRateLimit(`create-job:${user.id}`, LIMITS.createJob.limit, LIMITS.createJob.windowMs);
  const input = await readJson(req, createJobSchema);
  const job = await createPrintJob(user.id, input, { req });
  return json({ job: toJobDTO(job) }, 201);
});
