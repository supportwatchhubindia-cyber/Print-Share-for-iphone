import { prisma } from "@/server/db";
import { api, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { toDocumentDTO } from "@/server/dto";
import type { DocumentDTO, Paginated } from "@/lib/types";

export const GET = api(async (req) => {
  const { user } = await requireUser(req);
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
  const cursor = url.searchParams.get("cursor");

  const rows = await prisma.document.findMany({
    where: { userId: user.id, deletedAt: null, status: { in: ["READY", "PROCESSING"] }, expiresAt: { gt: new Date() } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const body: Paginated<DocumentDTO> = {
    items: rows.slice(0, limit).map(toDocumentDTO),
    nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
  };
  return json(body);
});
