import { api, json } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { listAllBridges, listAllPrinters } from "@/server/admin/service";

export const GET = api(async (req) => {
  await requireAdmin(req);
  const [printers, bridges] = await Promise.all([listAllPrinters(), listAllBridges()]);
  return json({ printers, bridges });
});
