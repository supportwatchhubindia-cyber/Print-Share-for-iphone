import { z } from "zod";
import {
  COLOR_MODES,
  DUPLEX_MODES,
  ORIENTATIONS,
  PAPER_SIZES,
  PRINT_QUALITIES,
  SCALE_MODES,
  PAPER_SIZE_INFO,
  PRINT_QUALITY_INFO,
} from "../constants";
import type { PrinterCapabilities } from "./capabilities";
import { parsePageRange } from "./page-range";

export const printSettingsSchema = z.object({
  copies: z.coerce.number().int().min(1, "At least 1 copy").max(99, "At most 99 copies"),
  pageRange: z.string().trim().max(200).nullish(),
  paperSize: z.enum(PAPER_SIZES),
  orientation: z.enum(ORIENTATIONS),
  colorMode: z.enum(COLOR_MODES).default("MONOCHROME"),
  duplex: z.enum(DUPLEX_MODES).default("SIMPLEX"),
  quality: z.enum(PRINT_QUALITIES).default("NORMAL"),
  scaleMode: z.enum(SCALE_MODES).default("FIT"),
});

export type PrintSettings = z.infer<typeof printSettingsSchema>;

export type SettingsValidation =
  | { ok: true; pages: number[]; normalizedRange: string | null }
  | { ok: false; fields: Record<string, string> };

/** Rejects any option the selected printer's driver/profile does not support. */
export function validateSettings(settings: PrintSettings, caps: PrinterCapabilities, pageCount: number): SettingsValidation {
  const fields: Record<string, string> = {};
  if (settings.copies > caps.maxCopies) fields.copies = `This printer accepts at most ${caps.maxCopies} copies.`;
  if (!caps.paperSizes.includes(settings.paperSize))
    fields.paperSize = `${PAPER_SIZE_INFO[settings.paperSize].label} is not supported by this printer.`;
  if (!caps.orientations.includes(settings.orientation)) fields.orientation = "Orientation not supported.";
  if (settings.colorMode === "COLOR" && !caps.color) fields.colorMode = "This printer prints in black and white only.";
  if (settings.duplex !== "SIMPLEX" && !caps.duplex) fields.duplex = "This printer supports single-sided printing only.";
  if (!caps.qualities.includes(settings.quality))
    fields.quality = `${PRINT_QUALITY_INFO[settings.quality].label} quality is not available on this printer.`;
  if (!caps.scaleModes.includes(settings.scaleMode)) fields.scaleMode = "Scaling mode not supported.";

  const range = parsePageRange(settings.pageRange, pageCount);
  if (!range.ok) fields.pageRange = range.error;

  if (Object.keys(fields).length || !range.ok) return { ok: false, fields };
  return { ok: true, pages: range.pages, normalizedRange: range.normalized };
}

/** Sensible defaults for a printer: first supported value of each option. */
export function defaultSettings(caps: PrinterCapabilities): PrintSettings {
  return {
    copies: 1,
    pageRange: null,
    paperSize: caps.paperSizes.includes("A4") ? "A4" : (caps.paperSizes[0] ?? "A4"),
    orientation: "PORTRAIT",
    colorMode: "MONOCHROME",
    duplex: "SIMPLEX",
    quality: caps.qualities.includes("NORMAL") ? "NORMAL" : (caps.qualities[0] ?? "NORMAL"),
    scaleMode: "FIT",
  };
}
