import { api, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { cancelPrintJob } from "@/server/printing/jobs";
import { toJobDTO } from "@/server/dto";

export const POST = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireUser(req);
  return json({ job: toJobDTO(await cancelPrintJob(user.id, params.id, req)) });
});
