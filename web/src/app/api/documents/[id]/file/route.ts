import { prisma } from "@/server/db";
import { api, notFound } from "@/server/http";
import { optionalUser } from "@/server/auth/guard";
import { verifyToken } from "@/server/crypto";
import { openObject, presignedObjectUrl } from "@/server/storage";

/**
 * Streams a document. Access requires either a valid signed token for this exact
 * document + variant, or a session belonging to the owner. Files are never public.
 * With Vercel Blob storage the response is a redirect to a 5-minute presigned URL instead.
 */
export const GET = api<{ id: string }>(async (req, { params }) => {
  const url = new URL(req.url);
  const variant = url.searchParams.get("variant") === "original" ? "original" : "pdf";
  const claims = verifyToken(url.searchParams.get("token"), "doc");
  const tokenOk = !!claims && claims.d === params.id && claims.v === variant;

  const doc = await prisma.document.findFirst({ where: { id: params.id, deletedAt: null } });
  if (!doc) throw notFound("Document");
  if (!tokenOk) {
    const auth = await optionalUser(req);
    if (!auth || auth.user.id !== doc.userId) throw notFound("Document");
  }
  if (doc.status === "EXPIRED" || doc.expiresAt.getTime() <= Date.now()) throw notFound("Document");

  const key = variant === "pdf" ? doc.pdfStorageKey : doc.storageKey;
  if (!key) throw notFound("Document");

  const presigned = await presignedObjectUrl(key, 300);
  if (presigned) return Response.redirect(presigned, 302);

  const object = await openObject(key);
  if (!object) throw notFound("Document");
  const isPdf = variant === "pdf";
  const filename = isPdf ? doc.originalName.replace(/\.[^.]+$/, "") + ".pdf" : doc.originalName;
  const inline = isPdf || doc.extension === "jpg" || doc.extension === "jpeg" || doc.extension === "png";
  return new Response(object.stream, {
    headers: {
      "Content-Type": isPdf ? "application/pdf" : doc.mimeType,
      "Content-Length": String(object.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
