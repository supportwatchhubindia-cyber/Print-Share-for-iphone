import { api, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { revokeBridge } from "@/server/bridge/service";

export const DELETE = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireUser(req);
  await revokeBridge(user.id, params.id, req);
  return json({ ok: true });
});
