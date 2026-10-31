import { api, json, readJson } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { registerPrinter, registerPrinterSchema } from "@/server/printing/printers";

export const POST = api(async (req) => {
  const { user } = await requireUser(req);
  const input = await readJson(req, registerPrinterSchema);
  return json({ printer: await registerPrinter(user.id, input, req) }, 201);
});
