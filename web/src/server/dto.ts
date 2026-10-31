import type { DesktopBridge, Document, Printer, PrintJob, PrintJobEvent, User, Subscription } from "@prisma/client";
import { parseCapabilities } from "@/lib/printing/capabilities";
import { connectionFromPort, identifyModel, modelByKey } from "@/lib/printing/models";
import { PRINTER_STATES, type PrinterState } from "@/lib/constants";
import type {
  BridgeDTO,
  DetectedPrinterDTO,
  DocumentDTO,
  PrinterDTO,
  PrintJobDTO,
  PrintJobEventDTO,
  SubscriptionDTO,
  UserDTO,
} from "@/lib/types";

export const BRIDGE_STALE_MS = 75_000;

export function isBridgeOnline(b: Pick<DesktopBridge, "status" | "lastSeenAt" | "revokedAt">, now = Date.now()): boolean {
  if (b.revokedAt || (b.status !== "ONLINE" && b.status !== "PAUSED")) return false;
  return !!b.lastSeenAt && now - b.lastSeenAt.getTime() < BRIDGE_STALE_MS;
}

export function toUserDTO(u: User): UserDTO {
  return { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, createdAt: u.createdAt.toISOString() };
}

export function toSubscriptionDTO(s: Subscription): SubscriptionDTO {
  return {
    plan: s.plan,
    status: s.status,
    monthlyPageLimit: s.monthlyPageLimit,
    maxPrinters: s.maxPrinters,
    currentPeriodStart: s.currentPeriodStart.toISOString(),
    currentPeriodEnd: s.currentPeriodEnd.toISOString(),
  };
}

export function toDocumentDTO(d: Document): DocumentDTO {
  return {
    id: d.id,
    name: d.originalName,
    extension: d.extension,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    pdfSizeBytes: d.pdfSizeBytes,
    pageCount: d.pageCount,
    status: d.status,
    errorMessage: d.errorMessage,
    scanStatus: d.scanStatus,
    expiresAt: d.expiresAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
  };
}

/** Shape stored in DesktopBridge.detectedPrinters (written by the heartbeat handler). */
export type StoredDetectedPrinter = {
  systemName: string;
  driverName: string | null;
  portName: string | null;
  isDefault: boolean;
  state: PrinterState;
  stateMessage: string | null;
  capabilities: {
    supportsColor: boolean;
    canDuplex: boolean;
    paperSizes: string[];
    resolutionsDpi: number[];
    maxCopies: number;
  } | null;
};

export function readDetectedPrinters(value: unknown): StoredDetectedPrinter[] {
  if (!Array.isArray(value)) return [];
  return value.filter((p): p is StoredDetectedPrinter => !!p && typeof p === "object" && typeof (p as { systemName?: unknown }).systemName === "string");
}

export function toBridgeDTO(b: DesktopBridge, registered: Pick<Printer, "id" | "systemName" | "removedAt">[]): BridgeDTO {
  const online = isBridgeOnline(b);
  const detected: DetectedPrinterDTO[] = readDetectedPrinters(b.detectedPrinters).map((p) => {
    const model = identifyModel(p.driverName, p.systemName);
    const reg = registered.find((r) => r.systemName === p.systemName && !r.removedAt);
    return {
      systemName: p.systemName,
      driverName: p.driverName,
      portName: p.portName,
      connection: connectionFromPort(p.portName),
      state: online && (PRINTER_STATES as readonly string[]).includes(p.state) ? p.state : "OFFLINE",
      isDefault: p.isDefault,
      modelKey: model.key,
      modelName: model.key === "GENERIC_WINDOWS" ? (p.driverName ?? "Windows printer") : model.displayName,
      registeredPrinterId: reg?.id ?? null,
    };
  });
  return {
    id: b.id,
    name: b.name,
    os: b.os,
    appVersion: b.appVersion,
    status: b.revokedAt ? "REVOKED" : online ? b.status : "OFFLINE",
    online,
    lastSeenAt: b.lastSeenAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    detectedPrinters: detected,
  };
}

export function toPrinterDTO(p: Printer & { bridge: DesktopBridge | null }, queuedJobs = 0): PrinterDTO {
  const bridgeOnline = p.bridge ? isBridgeOnline(p.bridge) : false;
  const state: PrinterState = bridgeOnline ? p.state : "OFFLINE";
  const available =
    bridgeOnline &&
    p.bridge?.status !== "PAUSED" &&
    !p.removedAt &&
    p.driverStatus !== "MISSING" &&
    (state === "READY" || state === "PRINTING");
  return {
    id: p.id,
    name: p.name,
    modelKey: p.modelKey,
    modelName: p.modelName,
    systemName: p.systemName,
    driverName: p.driverName,
    portName: p.portName,
    connection: p.connection,
    state,
    stateMessage: bridgeOnline ? p.stateMessage : p.bridge ? "The bridge computer is offline." : "No bridge attached.",
    driverStatus: p.driverStatus,
    capabilities: parseCapabilities(p.capabilities),
    available,
    lastConnectedAt: p.lastConnectedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    queuedJobs,
    verification: modelByKey(p.modelKey).verification,
    bridge: p.bridge
      ? {
          id: p.bridge.id,
          name: p.bridge.name,
          status: p.bridge.revokedAt ? "REVOKED" : bridgeOnline ? p.bridge.status : "OFFLINE",
          online: bridgeOnline,
          lastSeenAt: p.bridge.lastSeenAt?.toISOString() ?? null,
        }
      : null,
  };
}

export type JobWithRelations = PrintJob & {
  printer: Pick<Printer, "id" | "name" | "modelName">;
  document: Pick<Document, "status" | "expiresAt" | "deletedAt"> | null;
};

export const jobInclude = {
  printer: { select: { id: true, name: true, modelName: true } },
  document: { select: { status: true, expiresAt: true, deletedAt: true } },
} as const;

export function isDocumentAvailable(d: JobWithRelations["document"], now = Date.now()): boolean {
  return !!d && d.status === "READY" && !d.deletedAt && d.expiresAt.getTime() > now;
}

export function toJobDTO(j: JobWithRelations): PrintJobDTO {
  const documentAvailable = isDocumentAvailable(j.document);
  const active = j.status === "UPLOADED" || j.status === "QUEUED" || j.status === "PROCESSING" || j.status === "PRINTING";
  return {
    id: j.id,
    jobNumber: j.jobNumber,
    documentId: j.documentId,
    documentName: j.documentName,
    documentPages: j.documentPages,
    documentAvailable,
    printer: { id: j.printer.id, name: j.printer.name, modelName: j.printer.modelName },
    status: j.status,
    copies: j.copies,
    pageRange: j.pageRange,
    pagesSelected: j.pagesSelected,
    totalPages: j.pagesSelected * j.copies,
    paperSize: j.paperSize,
    orientation: j.orientation,
    colorMode: j.colorMode,
    duplex: j.duplex,
    quality: j.quality,
    scaleMode: j.scaleMode,
    isTest: j.isTest,
    attempt: j.attempt,
    spoolJobId: j.spoolJobId,
    pagesPrinted: j.pagesPrinted,
    printerAlert: j.printerAlert,
    errorCode: j.errorCode,
    errorMessage: j.errorMessage,
    cancelRequested: !!j.cancelRequestedAt,
    canCancel: active && !j.cancelRequestedAt,
    canRetry: (j.status === "FAILED" || j.status === "CANCELLED") && documentAvailable,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
    printingAt: j.printingAt?.toISOString() ?? null,
    completedAt: j.completedAt?.toISOString() ?? null,
  };
}

export function toJobEventDTO(e: PrintJobEvent): PrintJobEventDTO {
  return {
    id: e.id,
    status: e.status,
    type: e.type,
    message: e.message,
    source: e.source,
    metadata: (e.metadata as Record<string, unknown> | null) ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}
