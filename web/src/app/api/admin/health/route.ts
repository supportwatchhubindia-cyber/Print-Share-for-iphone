import { api, json } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { getSystemHealth, listAuditLogs } from "@/server/admin/service";

export const GET = api(async (req) => {
  await requireAdmin(req);
  const [health, auditLogs] = await Promise.all([getSystemHealth(), listAuditLogs(50)]);
  return json({ health, auditLogs });
});
