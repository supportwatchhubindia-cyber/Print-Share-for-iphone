import type {
  BridgeStatus,
  ColorMode,
  DocumentStatus,
  DriverStatus,
  DuplexMode,
  Orientation,
  PaperSize,
  PrintJobStatus,
  PrintQuality,
  PrinterConnection,
  PrinterState,
  Role,
  ScaleMode,
  ScanStatus,
  SubscriptionPlan,
} from "./constants";
import type { PrinterCapabilities } from "./printing/capabilities";

export type ApiErrorBody = {
  error: { code: string; message: string; details?: { fields?: Record<string, string>; [k: string]: unknown } };
};

export type UserDTO = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
};

export type SubscriptionDTO = {
  plan: SubscriptionPlan;
  status: "ACTIVE" | "PAST_DUE" | "CANCELED";
  monthlyPageLimit: number;
  maxPrinters: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
};

export type UsageSummaryDTO = {
  periodStart: string;
  periodEnd: string;
  pagesUsed: number;
  pageLimit: number;
  jobsThisPeriod: number;
  completedJobs: number;
  failedJobs: number;
  activeJobs: number;
  daily: { date: string; pages: number }[];
};

export type MeDTO = { user: UserDTO; subscription: SubscriptionDTO; usage: UsageSummaryDTO };

export type DocumentDTO = {
  id: string;
  name: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  pdfSizeBytes: number | null;
  pageCount: number | null;
  status: DocumentStatus;
  errorMessage: string | null;
  scanStatus: ScanStatus;
  expiresAt: string;
  createdAt: string;
};

export type DocumentDetailDTO = DocumentDTO & {
  /** Short-lived signed URL of the print-ready PDF. */
  pdfUrl: string | null;
  /** Short-lived signed URL of the original upload. */
  originalUrl: string;
};

export type DetectedPrinterDTO = {
  systemName: string;
  driverName: string | null;
  portName: string | null;
  connection: PrinterConnection;
  state: PrinterState;
  isDefault: boolean;
  modelKey: string;
  modelName: string;
  registeredPrinterId: string | null;
};

export type BridgeDTO = {
  id: string;
  name: string;
  os: string | null;
  appVersion: string | null;
  status: BridgeStatus;
  online: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  detectedPrinters: DetectedPrinterDTO[];
};

export type PrinterDTO = {
  id: string;
  name: string;
  modelKey: string;
  modelName: string;
  systemName: string | null;
  driverName: string | null;
  portName: string | null;
  connection: PrinterConnection;
  state: PrinterState;
  stateMessage: string | null;
  driverStatus: DriverStatus;
  capabilities: PrinterCapabilities;
  /** Bridge online and printer ready to accept work right now. */
  available: boolean;
  lastConnectedAt: string | null;
  createdAt: string;
  queuedJobs: number;
  verification: "VERIFIED" | "PENDING";
  bridge: { id: string; name: string; status: BridgeStatus; online: boolean; lastSeenAt: string | null } | null;
};

export type PrintJobDTO = {
  id: string;
  jobNumber: number;
  documentId: string | null;
  documentName: string;
  documentPages: number;
  documentAvailable: boolean;
  printer: { id: string; name: string; modelName: string };
  status: PrintJobStatus;
  copies: number;
  pageRange: string | null;
  pagesSelected: number;
  totalPages: number;
  paperSize: PaperSize;
  orientation: Orientation;
  colorMode: ColorMode;
  duplex: DuplexMode;
  quality: PrintQuality;
  scaleMode: ScaleMode;
  isTest: boolean;
  attempt: number;
  spoolJobId: number | null;
  pagesPrinted: number | null;
  printerAlert: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  cancelRequested: boolean;
  canCancel: boolean;
  canRetry: boolean;
  createdAt: string;
  updatedAt: string;
  printingAt: string | null;
  completedAt: string | null;
};

export type PrintJobEventDTO = {
  id: string;
  status: PrintJobStatus | null;
  type: string;
  message: string;
  source: "USER" | "BRIDGE" | "SYSTEM";
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type PrintJobDetailDTO = PrintJobDTO & { events: PrintJobEventDTO[] };

export type SessionDTO = {
  id: string;
  deviceLabel: string;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

export type Paginated<T> = { items: T[]; nextCursor: string | null };

/** Realtime events pushed over /ws to browsers. Kept small: clients refetch details. */
export type ClientRealtimeEvent =
  | { type: "job.updated"; jobId: string; status: PrintJobStatus }
  | { type: "printer.updated"; printerId: string | null }
  | { type: "bridge.updated"; bridgeId: string }
  | { type: "document.updated"; documentId: string };
