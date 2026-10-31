import { prisma } from "@/server/db";
import { api, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { getOwnedJob } from "@/server/printing/jobs";
import { toJobDTO, toJobEventDTO } from "@/server/dto";
import type { PrintJobDetailDTO } from "@/lib/types";

export const GET = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireUser(req);
  const job = await getOwnedJob(user.id, params.id);
  const events = await prisma.printJobEvent.findMany({ where: { printJobId: job.id }, orderBy: { createdAt: "asc" } });
  const body: PrintJobDetailDTO = { ...toJobDTO(job), events: events.map(toJobEventDTO) };
  return json({ job: body });
});
