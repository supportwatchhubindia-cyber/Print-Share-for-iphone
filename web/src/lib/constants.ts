// Shared enums. They mirror prisma/schema.prisma (checked by tests/unit/enums.test.ts)
// so client bundles never need @prisma/client.

export const PRINT_JOB_STATUSES = [
  "UPLOADED",
  "QUEUED",
  "PROCESSING",
  "PRINTING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

export const ACTIVE_JOB_STATUSES: readonly PrintJobStatus[] = ["UPLOADED", "QUEUED", "PROCESSING", "PRINTING"];
export const TERMINAL_JOB_STATUSES: readonly PrintJobStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

export const PAPER_SIZES = ["A4", "A5", "LETTER", "LEGAL"] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

export const PAPER_SIZE_INFO: Record<PaperSize, { label: string; widthMm: number; heightMm: number }> = {
  A4: { label: "A4 (210 × 297 mm)", widthMm: 210, heightMm: 297 },
  A5: { label: "A5 (148 × 210 mm)", widthMm: 148, heightMm: 210 },
  LETTER: { label: "Letter (8.5 × 11 in)", widthMm: 215.9, heightMm: 279.4 },
  LEGAL: { label: "Legal (8.5 × 14 in)", widthMm: 215.9, heightMm: 355.6 },
};

export const ORIENTATIONS = ["PORTRAIT", "LANDSCAPE"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const COLOR_MODES = ["MONOCHROME", "COLOR"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const DUPLEX_MODES = ["SIMPLEX", "LONG_EDGE", "SHORT_EDGE"] as const;
export type DuplexMode = (typeof DUPLEX_MODES)[number];

export const PRINT_QUALITIES = ["DRAFT", "NORMAL", "HIGH"] as const;
export type PrintQuality = (typeof PRINT_QUALITIES)[number];

export const PRINT_QUALITY_INFO: Record<PrintQuality, { label: string; dpi: number; hint: string }> = {
  DRAFT: { label: "Draft", dpi: 300, hint: "300 dpi · faster, uses less toner" },
  NORMAL: { label: "Normal", dpi: 600, hint: "600 dpi · crisp text" },
  HIGH: { label: "High", dpi: 1200, hint: "1200 dpi · only on printers that report it" },
};

export const SCALE_MODES = ["FIT", "ACTUAL"] as const;
export type ScaleMode = (typeof SCALE_MODES)[number];

export const PRINTER_STATES = [
  "READY",
  "PRINTING",
  "OFFLINE",
  "PAUSED",
  "PAPER_OUT",
  "PAPER_JAM",
  "DOOR_OPEN",
  "NO_TONER",
  "ERROR",
  "UNKNOWN",
] as const;
export type PrinterState = (typeof PRINTER_STATES)[number];

export const PRINTER_STATE_LABEL: Record<PrinterState, string> = {
  READY: "Ready",
  PRINTING: "Printing",
  OFFLINE: "Offline",
  PAUSED: "Paused",
  PAPER_OUT: "Out of paper",
  PAPER_JAM: "Paper jam",
  DOOR_OPEN: "Door open",
  NO_TONER: "No toner",
  ERROR: "Error",
  UNKNOWN: "Unknown",
};

export const PRINTER_CONNECTIONS = ["USB", "NETWORK", "VIRTUAL", "OTHER"] as const;
export type PrinterConnection = (typeof PRINTER_CONNECTIONS)[number];

export const DRIVER_STATUSES = ["INSTALLED", "MISSING", "UNKNOWN"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const BRIDGE_STATUSES = ["ONLINE", "OFFLINE", "PAUSED", "REVOKED"] as const;
export type BridgeStatus = (typeof BRIDGE_STATUSES)[number];

export const DOCUMENT_STATUSES = ["PROCESSING", "READY", "FAILED", "EXPIRED", "DELETED"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const SCAN_STATUSES = ["PENDING", "CLEAN", "INFECTED", "SKIPPED", "ERROR"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const SUBSCRIPTION_PLANS = ["FREE", "PRO", "BUSINESS"] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const ROLES = ["USER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** Upload formats. `family` drives magic-byte validation and conversion. */
export const FILE_TYPES = {
  pdf: { label: "PDF", family: "pdf", mime: "application/pdf" },
  jpg: { label: "JPG", family: "jpeg", mime: "image/jpeg" },
  jpeg: { label: "JPEG", family: "jpeg", mime: "image/jpeg" },
  png: { label: "PNG", family: "png", mime: "image/png" },
  docx: {
    label: "Word",
    family: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  xlsx: {
    label: "Excel",
    family: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  pptx: {
    label: "PowerPoint",
    family: "pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  txt: { label: "Text", family: "txt", mime: "text/plain" },
} as const;
export type FileExtension = keyof typeof FILE_TYPES;
export type FileFamily = (typeof FILE_TYPES)[FileExtension]["family"];

export const ACCEPTED_EXTENSIONS = Object.keys(FILE_TYPES) as FileExtension[];
export const ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_EXTENSIONS.map((e) => `.${e}`),
  ...new Set(Object.values(FILE_TYPES).map((t) => t.mime)),
].join(",");

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

export function isAcceptedExtension(ext: string): ext is FileExtension {
  return Object.prototype.hasOwnProperty.call(FILE_TYPES, ext);
}
