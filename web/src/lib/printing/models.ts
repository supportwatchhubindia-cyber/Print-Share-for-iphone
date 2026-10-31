import type { PrinterConnection } from "../constants";
import { GENERIC_CAPABILITIES, type PrinterCapabilities } from "./capabilities";

export type PrinterModel = {
  key: string;
  displayName: string;
  manufacturer: string;
  /** Matched against the Windows driver name reported by the bridge. */
  driverPattern: RegExp | null;
  defaultConnection: PrinterConnection;
  printLanguage: string;
  profile: PrinterCapabilities;
  notes: string[];
  /** Set to "VERIFIED" only after the checklist in docs/HARDWARE_VERIFICATION.md passes on real hardware. */
  verification: "VERIFIED" | "PENDING";
};

export const HP_LJ_M1005: PrinterModel = {
  key: "HP_LJ_M1005",
  displayName: "HP LaserJet MFP M1005",
  manufacturer: "HP",
  driverPattern: /M1005/i,
  defaultConnection: "USB",
  printLanguage: "Host-based (requires the HP Windows driver; no PCL or PostScript)",
  profile: {
    color: false,
    duplex: false,
    paperSizes: ["A4", "A5", "LETTER", "LEGAL"],
    qualities: ["DRAFT", "NORMAL"],
    orientations: ["PORTRAIT", "LANDSCAPE"],
    scaleModes: ["FIT", "ACTUAL"],
    maxCopies: 99,
    resolutionsDpi: [600],
    source: "MODEL_PROFILE",
  },
  notes: [
    "Monochrome laser — colour pages are printed in greyscale.",
    "Single-sided only; automatic duplex is not available on this model.",
    "USB 2.0 only: connect it to a Windows PC running the PrintShare Bridge.",
  ],
  verification: "PENDING",
};

export const GENERIC_WINDOWS_PRINTER: PrinterModel = {
  key: "GENERIC_WINDOWS",
  displayName: "Windows printer",
  manufacturer: "Various",
  driverPattern: null,
  defaultConnection: "OTHER",
  printLanguage: "Installed Windows driver",
  profile: GENERIC_CAPABILITIES,
  notes: ["Options are limited to what the installed Windows driver reports."],
  verification: "PENDING",
};

export const PRINTER_MODELS: PrinterModel[] = [HP_LJ_M1005, GENERIC_WINDOWS_PRINTER];

export function modelByKey(key: string | null | undefined): PrinterModel {
  return PRINTER_MODELS.find((m) => m.key === key) ?? GENERIC_WINDOWS_PRINTER;
}

/** Identify a catalogue model from the Windows driver name (e.g. "HP LaserJet M1005"). */
export function identifyModel(driverName: string | null | undefined, printerName?: string | null): PrinterModel {
  const haystack = `${driverName ?? ""} ${printerName ?? ""}`;
  return PRINTER_MODELS.find((m) => m.driverPattern?.test(haystack)) ?? GENERIC_WINDOWS_PRINTER;
}

export function connectionFromPort(portName: string | null | undefined): PrinterConnection {
  const port = (portName ?? "").toUpperCase();
  if (/^USB\d+/.test(port) || port.startsWith("DOT4")) return "USB";
  if (port.startsWith("IP_") || port.startsWith("WSD") || /^\d+\.\d+\.\d+\.\d+/.test(port) || port.startsWith("HTTP"))
    return "NETWORK";
  if (port === "PORTPROMPT:" || port === "NUL:" || port.startsWith("FILE:")) return "VIRTUAL";
  return "OTHER";
}
