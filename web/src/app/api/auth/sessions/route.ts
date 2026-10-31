import { prisma } from "@/server/db";
import { api, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import type { SessionDTO } from "@/lib/types";

export const GET = api(async (req) => {
  const { user, session } = await requireUser(req);
  const sessions = await prisma.deviceSession.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
  });
  const items: SessionDTO[] = sessions.map((s) => ({
    id: s.id,
    deviceLabel: s.deviceLabel ?? "Unknown device",
    ipAddress: s.ipAddress,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    current: s.id === session.id,
  }));
  return json({ sessions: items });
});
