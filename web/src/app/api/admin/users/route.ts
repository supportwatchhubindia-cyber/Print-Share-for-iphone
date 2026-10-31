import { api, json } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { listUsers } from "@/server/admin/service";

export const GET = api(async (req) => {
  await requireAdmin(req);
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 100) || null;
  return json({ users: await listUsers(q) });
});
