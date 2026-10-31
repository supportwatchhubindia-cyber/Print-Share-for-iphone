import { api, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { retryPrintJob } from "@/server/printing/jobs";
import { toJobDTO } from "@/server/dto";

export const POST = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireUser(req);
  enforceRateLimit(`create-job:${user.id}`, LIMITS.createJob.limit, LIMITS.createJob.windowMs);
  return json({ job: toJobDTO(await retryPrintJob(user.id, params.id, req)) });
});
