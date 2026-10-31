import { ApiError, api, badRequest, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { env } from "@/server/env";
import { ingestUpload } from "@/server/documents/service";
import { toDocumentDTO } from "@/server/dto";

export const POST = api(async (req) => {
  const { user } = await requireUser(req);
  enforceRateLimit(`upload:${user.id}`, LIMITS.upload.limit, LIMITS.upload.windowMs);

  // Reject oversized bodies before buffering them.
  const max = env().MAX_UPLOAD_MB * 1024 * 1024;
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > max + 64 * 1024) throw new ApiError(413, "FILE_TOO_LARGE", `Files must be ${env().MAX_UPLOAD_MB} MB or smaller.`);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Send the file as multipart/form-data in a field named \"file\".");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Send the file as multipart/form-data in a field named \"file\".");

  const doc = await ingestUpload(user.id, file, req);
  return json({ document: toDocumentDTO(doc) }, 201);
});
