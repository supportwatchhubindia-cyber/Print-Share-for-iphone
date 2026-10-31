import { api, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { enforceRateLimit } from "@/server/rate-limit";
import { sendTestPage } from "@/server/printing/printers";
import { toJobDTO } from "@/server/dto";

export const POST = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireUser(req);
  enforceRateLimit(`test-print:${user.id}`, 5, 60_000);
  const job = await sendTestPage(user.id, params.id, req);
  return json({ job: toJobDTO(job) }, 201);
});
