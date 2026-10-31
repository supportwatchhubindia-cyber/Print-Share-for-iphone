import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { api, badRequest, forbidden, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { maxUploadBytes } from "@/server/documents/service";
import { INCOMING_PATTERN } from "@/server/storage";
import { FILE_TYPES } from "@/lib/constants";

const ALLOWED_TYPES = [...new Set(Object.values(FILE_TYPES).map((t) => t.mime))];

/**
 * Issues a short-lived Vercel Blob client token so the browser can upload straight to
 * private Blob storage (bypassing the 4.5 MB function body limit). The token is scoped to a
 * single pathname under incoming/<userId>/, an allow-listed content type and the size limit.
 */
export const POST = api(async (req) => {
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    throw badRequest("Invalid upload request.");
  }
  const result = await handleUpload({
    body,
    request: req,
    onBeforeGenerateToken: async (pathname) => {
      const { user } = await requireUser(req);
      enforceRateLimit(`upload:${user.id}`, LIMITS.upload.limit, LIMITS.upload.windowMs);
      const match = INCOMING_PATTERN.exec(pathname);
      if (!match || match[1] !== user.id) throw forbidden("Uploads must go to your own incoming folder.");
      // The browser uploads with access "private"; ingest only reads incoming blobs as private.
      return {
        allowedContentTypes: ALLOWED_TYPES,
        maximumSizeInBytes: maxUploadBytes(),
        addRandomSuffix: false,
        allowOverwrite: false,
        validUntil: Date.now() + 10 * 60_000,
        tokenPayload: user.id,
      };
    },
  });
  return json(result);
});
