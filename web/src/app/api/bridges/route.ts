import { prisma } from "@/server/db";
import { api, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { toBridgeDTO } from "@/server/dto";

export const GET = api(async (req) => {
  const { user } = await requireUser(req);
  const bridges = await prisma.desktopBridge.findMany({
    where: { userId: user.id, revokedAt: null },
    include: { printers: { select: { id: true, systemName: true, removedAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  return json({ bridges: bridges.map((b) => toBridgeDTO(b, b.printers)) });
});
