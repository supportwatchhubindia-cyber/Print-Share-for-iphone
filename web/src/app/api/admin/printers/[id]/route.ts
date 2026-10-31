import { prisma } from "@/server/db";
import { api, json, notFound } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { removePrinter } from "@/server/printing/printers";
import { audit } from "@/server/audit";

export const DELETE = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireAdmin(req);
  const printer = await prisma.printer.findFirst({ where: { id: params.id, removedAt: null } });
  if (!printer) throw notFound("Printer");
  await removePrinter(printer.userId, printer.id, req);
  await audit({ action: "admin.printer_remove", actorType: "ADMIN", actorId: user.id, userId: printer.userId, targetType: "Printer", targetId: printer.id, req });
  return json({ ok: true });
});
