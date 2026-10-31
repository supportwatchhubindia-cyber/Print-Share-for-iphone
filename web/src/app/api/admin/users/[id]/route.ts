import { api, json, readJson } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { adminUpdateUserSchema, updateUser } from "@/server/admin/service";

export const PATCH = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireAdmin(req);
  const input = await readJson(req, adminUpdateUserSchema);
  await updateUser(user.id, params.id, input, req);
  return json({ ok: true });
});
