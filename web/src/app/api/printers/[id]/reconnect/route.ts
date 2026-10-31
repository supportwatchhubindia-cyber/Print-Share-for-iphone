import { api, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { reconnectPrinter } from "@/server/printing/printers";

export const POST = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireUser(req);
  return json({ printer: await reconnectPrinter(user.id, params.id, req) });
});
