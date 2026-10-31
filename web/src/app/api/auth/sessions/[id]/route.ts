import { prisma } from "@/server/db";
import { api, json, notFound } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { revokeSession } from "@/server/auth/session";
import { audit } from "@/server/audit";

export const DELETE = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireUser(req);
  const target = await prisma.deviceSession.findFirst({ where: { id: params.id, userId: user.id } });
  if (!target) throw notFound("Session");
  await revokeSession(target.id);
  await audit({ action: "auth.session_revoked", actorType: "USER", actorId: user.id, userId: user.id, targetType: "DeviceSession", targetId: target.id, req });
  return json({ ok: true });
});
