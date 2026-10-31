import { ApiError, api, badRequest, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { ingestUpload, maxUploadBytes } from "@/server/documents/service";
import { scheduleMaintenance } from "@/server/background";
import { toDocumentDTO } from "@/server/dto";
import { env } from "@/server/env";

export const maxDuration = 60;

/**
 * Direct multipart upload (self-hosted). On Vercel, function bodies are capped at 4.5 MB, so the
 * browser uploads to Vercel Blob instead and calls /api/documents/ingest.
 */
export const POST = api(async (req) => {
  const { user } = await requireUser(req);
  enforceRateLimit(`upload:${user.id}`, LIMITS.upload.limit, LIMITS.upload.windowMs);

  // Reject oversized bodies before buffering them.
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > maxUploadBytes() + 64 * 1024) throw new ApiError(413, "FILE_TOO_LARGE", `Files must be ${env().MAX_UPLOAD_MB} MB or smaller.`);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Send the file as multipart/form-data in a field named \"file\".");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Send the file as multipart/form-data in a field named \"file\".");

  const doc = await ingestUpload(user.id, { name: file.name, size: file.size, read: async () => Buffer.from(await file.arrayBuffer()) }, req);
  scheduleMaintenance();
  return json({ document: toDocumentDTO(doc) }, 201);
});
