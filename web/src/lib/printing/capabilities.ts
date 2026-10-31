import {
  ORIENTATIONS,
  PAPER_SIZES,
  PRINT_QUALITIES,
  SCALE_MODES,
  type Orientation,
  type PaperSize,
  type PrintQuality,
  type ScaleMode,
} from "../constants";

/** What the print-settings UI may offer and what the API will accept for a printer. */
export type PrinterCapabilities = {
  color: boolean;
  duplex: boolean;
  paperSizes: PaperSize[];
  qualities: PrintQuality[];
  orientations: Orientation[];
  scaleModes: ScaleMode[];
  maxCopies: number;
  resolutionsDpi: number[];
  /** MODEL_PROFILE until the bridge has reported the installed driver's capabilities. */
  source: "MODEL_PROFILE" | "DRIVER";
};

/** Capabilities as read from the Windows driver by the bridge (System.Drawing.Printing). */
export type DriverCapabilities = {
  supportsColor: boolean;
  canDuplex: boolean;
  paperSizes: string[];
  resolutionsDpi: number[];
  maxCopies: number;
};

export function qualitiesForResolutions(dpis: number[]): PrintQuality[] {
  const max = dpis.length ? Math.max(...dpis) : 600;
  const out: PrintQuality[] = ["DRAFT"];
  if (max >= 600) out.push("NORMAL");
  if (max >= 1200) out.push("HIGH");
  return out;
}

/**
 * Effective capabilities = model profile ∩ driver report. A feature is offered only
 * when both the model profile and the installed driver allow it, so a mono/simplex
 * profile (HP M1005) can never be widened by a misreporting driver.
 */
export function mergeCapabilities(profile: PrinterCapabilities, driver?: DriverCapabilities | null): PrinterCapabilities {
  if (!driver) return { ...profile, source: "MODEL_PROFILE" };
  const driverPapers = new Set(driver.paperSizes.map((p) => p.toUpperCase()));
  const paperSizes = profile.paperSizes.filter((p) => driverPapers.has(p));
  const resolutionsDpi = [...new Set(driver.resolutionsDpi.filter((d) => d > 0))].sort((a, b) => a - b);
  const driverQualities = new Set(qualitiesForResolutions(resolutionsDpi));
  const qualities = profile.qualities.filter((q) => driverQualities.has(q));
  return {
    color: profile.color && driver.supportsColor,
    duplex: profile.duplex && driver.canDuplex,
    paperSizes: paperSizes.length ? paperSizes : profile.paperSizes,
    qualities: qualities.length ? qualities : ["NORMAL"],
    orientations: profile.orientations,
    scaleModes: profile.scaleModes,
    // Not limited by the driver: when a driver can't produce copies (e.g. Microsoft Print to PDF
    // reports 1), the bridge repeats the pages itself.
    maxCopies: profile.maxCopies,
    resolutionsDpi: resolutionsDpi.length ? resolutionsDpi : profile.resolutionsDpi,
    source: "DRIVER",
  };
}

export const GENERIC_CAPABILITIES: PrinterCapabilities = {
  color: true,
  duplex: true,
  paperSizes: [...PAPER_SIZES],
  qualities: [...PRINT_QUALITIES],
  orientations: [...ORIENTATIONS],
  scaleModes: [...SCALE_MODES],
  maxCopies: 99,
  resolutionsDpi: [300, 600, 1200],
  source: "MODEL_PROFILE",
};

export function parseCapabilities(value: unknown): PrinterCapabilities {
  const v = (value ?? {}) as Partial<PrinterCapabilities>;
  const pick = <T extends string>(list: unknown, allowed: readonly T[], fallback: T[]): T[] =>
    Array.isArray(list) ? (list.filter((x) => (allowed as readonly string[]).includes(x)) as T[]) : fallback;
  return {
    color: v.color === true,
    duplex: v.duplex === true,
    paperSizes: pick(v.paperSizes, PAPER_SIZES, ["A4"]),
    qualities: pick(v.qualities, PRINT_QUALITIES, ["NORMAL"]),
    orientations: pick(v.orientations, ORIENTATIONS, [...ORIENTATIONS]),
    scaleModes: pick(v.scaleModes, SCALE_MODES, [...SCALE_MODES]),
    maxCopies: typeof v.maxCopies === "number" && v.maxCopies > 0 ? Math.min(999, v.maxCopies) : 1,
    resolutionsDpi: Array.isArray(v.resolutionsDpi) ? v.resolutionsDpi.filter((n) => typeof n === "number") : [],
    source: v.source === "DRIVER" ? "DRIVER" : "MODEL_PROFILE",
  };
}
