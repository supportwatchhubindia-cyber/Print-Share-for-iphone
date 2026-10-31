import { z } from "zod";
import { prisma } from "@/server/db";
import { api, json, readJson } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { getOwnedPrinter, removePrinter, renamePrinter } from "@/server/printing/printers";
import { toPrinterDTO } from "@/server/dto";
import { modelByKey } from "@/lib/printing/models";

export const GET = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireUser(req);
  const printer = await getOwnedPrinter(user.id, params.id);
  const queued = await prisma.printJob.count({
    where: { printerId: printer.id, status: { in: ["UPLOADED", "QUEUED", "PROCESSING", "PRINTING"] } },
  });
  const model = modelByKey(printer.modelKey);
  return json({
    printer: toPrinterDTO(printer, queued),
    model: { displayName: model.displayName, printLanguage: model.printLanguage, notes: model.notes, verification: model.verification },
  });
});

const patchSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const PATCH = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireUser(req);
  const { name } = await readJson(req, patchSchema);
  return json({ printer: await renamePrinter(user.id, params.id, name) });
});

export const DELETE = api<{ id: string }>(async (req, { params }) => {
  const { user } = await requireUser(req);
  await removePrinter(user.id, params.id, req);
  return json({ ok: true });
});
