import { api, notFound } from "@/server/http";
import { requireBridge } from "@/server/bridge/service";
import { verifyToken } from "@/server/crypto";
import { jobForDownload } from "@/server/printing/jobs";
import { openObject, presignedObjectUrl } from "@/server/storage";

/**
 * Secure document download for the bridge: requires the bridge's own credentials AND
 * a short-lived token bound to (job, bridge, attempt). The bridge verifies the SHA-256.
 * With Vercel Blob storage this redirects to a 5-minute presigned URL (the bridge follows
 * it without sending its credential).
 */
export const GET = api<{ id: string }>(async (req, { params }) => {
  const bridge = await requireBridge(req);
  const claims = verifyToken(new URL(req.url).searchParams.get("token"), "bridge-doc");
  const job = claims ? await jobForDownload(bridge, params.id, claims) : null;
  if (!job?.document?.pdfStorageKey) throw notFound("Document");

  const presigned = await presignedObjectUrl(job.document.pdfStorageKey, 300);
  if (presigned) {
    return new Response(null, {
      status: 302,
      headers: { Location: presigned, "Cache-Control": "no-store", "X-Document-Sha256": job.document.pdfSha256 ?? "" },
    });
  }

  const object = await openObject(job.document.pdfStorageKey);
  if (!object) throw notFound("Document");
  return new Response(object.stream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(object.size),
      "Cache-Control": "no-store",
      "X-Document-Sha256": job.document.pdfSha256 ?? "",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
