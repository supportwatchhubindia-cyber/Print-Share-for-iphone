import type { PrintJobStatus } from "../constants";

/**
 * Print job state machine. COMPLETED is only reachable from the bridge after the
 * Windows spooler confirms the job; FAILED/CANCELLED may be retried (new attempt).
 * PROCESSING -> QUEUED is a bridge "release" before anything was spooled.
 */
export const JOB_TRANSITIONS: Record<PrintJobStatus, readonly PrintJobStatus[]> = {
  UPLOADED: ["QUEUED", "FAILED", "CANCELLED"],
  QUEUED: ["PROCESSING", "FAILED", "CANCELLED"],
  PROCESSING: ["PRINTING", "COMPLETED", "FAILED", "CANCELLED", "QUEUED"],
  PRINTING: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: ["QUEUED"],
  CANCELLED: ["QUEUED"],
};

export function canTransition(from: PrintJobStatus, to: PrintJobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

export const JOB_STATUS_LABEL: Record<PrintJobStatus, string> = {
  UPLOADED: "Uploaded",
  QUEUED: "Queued",
  PROCESSING: "Processing",
  PRINTING: "Printing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const JOB_STATUS_HINT: Record<PrintJobStatus, string> = {
  UPLOADED: "Preparing the document",
  QUEUED: "Waiting for the printer's bridge to pick it up",
  PROCESSING: "Bridge is downloading and rendering the document",
  PRINTING: "Sent to the Windows print spooler",
  COMPLETED: "Windows spooler confirmed the job was delivered to the printer",
  FAILED: "The job did not print",
  CANCELLED: "The job was cancelled",
};
