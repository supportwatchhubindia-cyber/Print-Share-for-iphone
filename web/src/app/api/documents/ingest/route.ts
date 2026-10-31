import { z } from "zod";
import { api, forbidden, json, notFound, readJson } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { ingestUpload, maxUploadBytes } from "@/server/documents/service";
import { scheduleMaintenance } from "@/server/background";
import { deleteObject, INCOMING_PATTERN, openObject, readObject } from "@/server/storage";
import { toDocumentDTO } from "@/server/dto";

export const maxDuration = 60;

const schema = z.object({
  pathname: z.string().max(200),
  name: z.string().trim().min(1).max(255),
});

/**
 * Second half of a browser-to-Blob upload: validates the uploaded blob belongs to this user,
 * then runs the normal pipeline (magic bytes, malware scan, conversion) and removes the
 * temporary incoming blob.
 */
export const POST = api(async (req) => {
  const { user } = await requireUser(req);
  enforceRateLimit(`ingest:${user.id}`, LIMITS.upload.limit, LIMITS.upload.windowMs);
  const { pathname, name } = await readJson(req, schema);
  const match = INCOMING_PATTERN.exec(pathname);
  if (!match || match[1] !== user.id) throw forbidden("This upload does not belong to you.");

  const head = await openObject(pathname);
  if (!head) throw notFound("Upload");
  await head.stream.cancel();
  try {
    const doc = await ingestUpload(
      user.id,
      { name, size: head.size, read: async () => (await readObject(pathname, maxUploadBytes())) ?? Buffer.alloc(0) },
      req,
    );
    scheduleMaintenance();
    return json({ document: toDocumentDTO(doc) }, 201);
  } finally {
    await deleteObject(pathname).catch((err) => console.error("[ingest] could not delete incoming blob", pathname, err));
  }
});
