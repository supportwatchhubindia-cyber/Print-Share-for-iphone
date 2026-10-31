import { api, json } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { getAdminStats } from "@/server/admin/service";

export const GET = api(async (req) => {
  await requireAdmin(req);
  return json({ stats: await getAdminStats() });
});
