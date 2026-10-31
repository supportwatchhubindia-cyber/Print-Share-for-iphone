import { api, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { listPrinters } from "@/server/printing/printers";

export const GET = api(async (req) => {
  const { user } = await requireUser(req);
  return json({ printers: await listPrinters(user.id) });
});
