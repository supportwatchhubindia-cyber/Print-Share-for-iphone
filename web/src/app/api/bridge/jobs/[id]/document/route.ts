import { api, notFound } from "@/server/http";
import { requireBridge } from "@/server/bridge/service";
import { verifyToken } from "@/server/crypto";
import { jobForDownload } from "@/server/printing/jobs";
import { objectSize, objectWebStream } from "@/server/storage";

/**
 * Secure document download for the bridge: requires the bridge's own credentials AND
 * a short-lived token bound to (job, bridge, attempt). The bridge verifies the SHA-256.
 */
export const GET = api<{ id: string }>(async (req, { params }) => {
  const bridge = await requireBridge(req);
  const claims = verifyToken(new URL(req.url).searchParams.get("token"), "bridge-doc");
  const job = claims ? await jobForDownload(bridge, params.id, claims) : null;
  if (!job?.document?.pdfStorageKey) throw notFound("Document");
  const size = await objectSize(job.document.pdfStorageKey);
  if (size == null) throw notFound("Document");
  return new Response(objectWebStream(job.document.pdfStorageKey), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(size),
      "Cache-Control": "no-store",
      "X-Document-Sha256": job.document.pdfSha256 ?? "",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
