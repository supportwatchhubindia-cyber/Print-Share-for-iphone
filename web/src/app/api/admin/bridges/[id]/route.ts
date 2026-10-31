import { api, json } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { revokeBridge } from "@/server/bridge/service";

export const DELETE = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireAdmin(req);
  await revokeBridge(user.id, params.id, req, "ADMIN");
  return json({ ok: true });
});
