import type { Document } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { ApiError, conflict, notFound, unprocessable } from "../errors";
import { sha256Hex, signToken } from "../crypto";
import { deletePrefix, documentFolder, documentKey, presignedObjectUrl, writeObject } from "../storage";
import { audit } from "../audit";
import { validateContent } from "./detect";
import { scanUpload } from "./scan";
import { ConversionError, imageToPdf, inspectPdf, officeToPdf, textToPdf } from "./convert";
import { FILE_TYPES, extensionOf, isAcceptedExtension, ACCEPTED_EXTENSIONS, type FileExtension } from "@/lib/constants";

export const DOC_URL_TTL_SECONDS = 15 * 60;

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return "document";
  if (clean.length <= 180) return clean;
  const ext = extensionOf(clean);
  return `${clean.slice(0, 170)}${ext ? `.${ext}` : ""}`;
}

async function toPrintablePdf(ext: FileExtension, buf: Buffer): Promise<Buffer> {
  switch (FILE_TYPES[ext].family) {
    case "pdf":
      return buf;
    case "jpeg":
    case "png":
      return imageToPdf(buf);
    case "txt":
      return textToPdf(buf);
    case "docx":
    case "xlsx":
    case "pptx":
      return officeToPdf(buf, FILE_TYPES[ext].family as "docx" | "xlsx" | "pptx");
  }
}

/** An upload from either a multipart request (self-hosted) or a browser-to-Blob upload (Vercel). */
export type UploadSource = { name: string; size: number; read: () => Promise<Buffer> };

export function maxUploadBytes() {
  return env().MAX_UPLOAD_MB * 1024 * 1024;
}

/**
 * Validates, scans, stores and converts an upload to a print-ready PDF.
 * Processing is synchronous so the response already carries the page count.
 */
export async function ingestUpload(userId: string, source: UploadSource, req?: Request): Promise<Document> {
  const { MAX_UPLOAD_MB, DOCUMENT_TTL_HOURS, MALWARE_SCAN_REQUIRED } = env();
  const name = sanitizeFilename(source.name || "document");
  const ext = extensionOf(name);
  if (!isAcceptedExtension(ext)) {
    throw unprocessable("UNSUPPORTED_TYPE", `".${ext || "?"}" files are not supported. Use ${ACCEPTED_EXTENSIONS.join(", ").toUpperCase()}.`);
  }
  if (source.size === 0) throw unprocessable("EMPTY_FILE", "The file is empty.");
  if (source.size > maxUploadBytes()) {
    throw new ApiError(413, "FILE_TOO_LARGE", `Files must be ${MAX_UPLOAD_MB} MB or smaller.`);
  }
  const buf = await source.read();
  if (buf.length === 0) throw unprocessable("EMPTY_FILE", "The file is empty.");
  const check = validateContent(ext, buf);
  if (!check.ok) throw unprocessable("CONTENT_MISMATCH", check.reason);

  const doc = await prisma.document.create({
    data: {
      userId,
      originalName: name,
      extension: ext,
      mimeType: FILE_TYPES[ext].mime,
      sizeBytes: buf.length,
      storageKey: "",
      status: "PROCESSING",
      expiresAt: new Date(Date.now() + DOCUMENT_TTL_HOURS * 3_600_000),
    },
  });
  const folder = documentFolder(userId, doc.id);
  const originalKey = documentKey(userId, doc.id, `original.${ext}`);

  const fail = async (code: string, message: string, status = 422, scan?: { status: Document["scanStatus"]; detail?: string }) => {
    await deletePrefix(folder).catch(() => undefined);
    await prisma.document.update({
      where: { id: doc.id },
      data: { status: "FAILED", errorMessage: message, ...(scan ? { scanStatus: scan.status, scanDetail: scan.detail } : {}) },
    });
    return new ApiError(status, code, message, { documentId: doc.id });
  };

  await writeObject(originalKey, buf, FILE_TYPES[ext].mime);
  await prisma.document.update({ where: { id: doc.id }, data: { storageKey: originalKey } });

  const scan = await scanUpload(buf);
  if (scan.status === "INFECTED") {
    await audit({ action: "document.malware_detected", actorType: "SYSTEM", userId, targetType: "Document", targetId: doc.id, req, metadata: { signature: scan.detail ?? "" } });
    throw await fail("MALWARE_DETECTED", "This file was blocked by the malware scanner.", 422, { status: "INFECTED", detail: scan.detail });
  }
  if (MALWARE_SCAN_REQUIRED && scan.status !== "CLEAN") {
    throw await fail("SCANNER_UNAVAILABLE", "Uploads are temporarily unavailable because the malware scanner is offline.", 503, {
      status: scan.status,
      detail: scan.detail,
    });
  }

  try {
    const pdf = await toPrintablePdf(ext, buf);
    const { pageCount } = await inspectPdf(pdf);
    let pdfKey = originalKey;
    if (ext !== "pdf") {
      pdfKey = documentKey(userId, doc.id, "print.pdf");
      await writeObject(pdfKey, pdf, "application/pdf");
    }
    const ready = await prisma.document.update({
      where: { id: doc.id },
      data: {
        status: "READY",
        pageCount,
        pdfStorageKey: pdfKey,
        pdfSizeBytes: pdf.length,
        pdfSha256: sha256Hex(pdf),
        scanStatus: scan.status,
        scanDetail: scan.detail,
      },
    });
    await audit({ action: "document.upload", actorType: "USER", actorId: userId, userId, targetType: "Document", targetId: doc.id, req, metadata: { ext, sizeBytes: buf.length, pageCount } });
    return ready;
  } catch (err) {
    if (err instanceof ConversionError) {
      throw await fail(err.code, err.message);
    }
    await fail("CONVERSION_FAILED", "The document could not be prepared for printing.");
    throw err;
  }
}

export async function getOwnedDocument(userId: string, id: string): Promise<Document> {
  const doc = await prisma.document.findFirst({ where: { id, userId, deletedAt: null } });
  if (!doc) throw notFound("Document");
  return doc;
}

export function signedDocumentUrl(docId: string, variant: "pdf" | "original"): string {
  const token = signToken("doc", { d: docId, v: variant }, DOC_URL_TTL_SECONDS);
  return `/api/documents/${docId}/file?variant=${variant}&token=${encodeURIComponent(token)}`;
}

/**
 * Short-lived URL for a document file. With Vercel Blob it is a presigned Blob URL so the
 * file never passes through a function (4.5 MB response cap); locally it is our signed route.
 */
export async function documentFileUrl(doc: Pick<Document, "id" | "storageKey" | "pdfStorageKey">, variant: "pdf" | "original"): Promise<string | null> {
  const key = variant === "pdf" ? doc.pdfStorageKey : doc.storageKey;
  if (!key) return null;
  return (await presignedObjectUrl(key, DOC_URL_TTL_SECONDS)) ?? signedDocumentUrl(doc.id, variant);
}

export async function deleteDocument(userId: string, id: string, req?: Request) {
  const doc = await getOwnedDocument(userId, id);
  const active = await prisma.printJob.count({
    where: { documentId: doc.id, status: { in: ["UPLOADED", "QUEUED", "PROCESSING", "PRINTING"] } },
  });
  if (active > 0) throw conflict("This document is still being printed. Cancel the job first.", "DOCUMENT_IN_USE");
  await deletePrefix(documentFolder(userId, doc.id));
  await prisma.document.update({ where: { id: doc.id }, data: { status: "DELETED", deletedAt: new Date() } });
  await audit({ action: "document.delete", actorType: "USER", actorId: userId, userId, targetType: "Document", targetId: doc.id, req });
}

/** Deletes files of expired documents. Documents with unfinished jobs are kept until those finish. */
export async function expireDocuments(now = new Date()): Promise<number> {
  const due = await prisma.document.findMany({
    where: {
      expiresAt: { lte: now },
      status: { in: ["READY", "PROCESSING", "FAILED"] },
      printJobs: { none: { status: { in: ["UPLOADED", "QUEUED", "PROCESSING", "PRINTING"] } } },
    },
    select: { id: true, userId: true },
    take: 500,
  });
  for (const d of due) {
    await deletePrefix(documentFolder(d.userId, d.id)).catch((err) =>
      console.error("[expire] could not delete files for", d.id, err),
    );
    await prisma.document.update({ where: { id: d.id }, data: { status: "EXPIRED" } });
  }
  return due.length;
}
