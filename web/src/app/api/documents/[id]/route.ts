import { api, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { deleteDocument, getOwnedDocument, signedDocumentUrl } from "@/server/documents/service";
import { toDocumentDTO } from "@/server/dto";
import type { DocumentDetailDTO } from "@/lib/types";

export const GET = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireUser(req);
  const doc = await getOwnedDocument(user.id, params.id);
  const live = doc.status === "READY" && doc.expiresAt.getTime() > Date.now();
  const body: DocumentDetailDTO = {
    ...toDocumentDTO(doc),
    pdfUrl: live && doc.pdfStorageKey ? signedDocumentUrl(doc.id, "pdf") : null,
    originalUrl: signedDocumentUrl(doc.id, "original"),
  };
  return json({ document: body });
});

export const DELETE = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireUser(req);
  await deleteDocument(user.id, params.id, req);
  return json({ ok: true });
});
