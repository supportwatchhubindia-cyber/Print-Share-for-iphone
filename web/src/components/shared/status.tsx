import {
  Ban,
  CircleCheck,
  CircleX,
  Clock,
  FileUp,
  LoaderCircle,
  PauseCircle,
  Printer,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { JOB_STATUS_LABEL } from "@/lib/printing/transitions";
import { PRINTER_STATE_LABEL, type PrinterState, type PrintJobStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

const JOB_TONE: Record<PrintJobStatus, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  UPLOADED: "neutral",
  QUEUED: "neutral",
  PROCESSING: "accent",
  PRINTING: "accent",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};

const JOB_ICON: Record<PrintJobStatus, React.ReactNode> = {
  UPLOADED: <FileUp aria-hidden />,
  QUEUED: <Clock aria-hidden />,
  PROCESSING: <LoaderCircle className="animate-spin" aria-hidden />,
  PRINTING: <Printer aria-hidden />,
  COMPLETED: <CircleCheck aria-hidden />,
  FAILED: <CircleX aria-hidden />,
  CANCELLED: <Ban aria-hidden />,
};

export function JobStatusBadge({ status, cancelRequested, className }: { status: PrintJobStatus; cancelRequested?: boolean; className?: string }) {
  if (cancelRequested && (status === "PROCESSING" || status === "PRINTING")) {
    return (
      <Badge tone="warning" className={className}>
        <LoaderCircle className="animate-spin" aria-hidden /> Cancelling
      </Badge>
    );
  }
  return (
    <Badge tone={JOB_TONE[status]} className={className}>
      {JOB_ICON[status]}
      {JOB_STATUS_LABEL[status]}
    </Badge>
  );
}

export function PrinterStateBadge({ state, available, className }: { state: PrinterState; available?: boolean; className?: string }) {
  const tone = state === "READY" || state === "PRINTING" ? "success" : state === "OFFLINE" || state === "UNKNOWN" ? "neutral" : state === "PAUSED" ? "warning" : "danger";
  const icon =
    state === "READY" ? (
      <span className="size-1.5 rounded-full bg-success" aria-hidden />
    ) : state === "PRINTING" ? (
      <Printer aria-hidden />
    ) : state === "OFFLINE" ? (
      <WifiOff aria-hidden />
    ) : state === "PAUSED" ? (
      <PauseCircle aria-hidden />
    ) : state === "UNKNOWN" ? null : (
      <TriangleAlert aria-hidden />
    );
  return (
    <Badge tone={tone} className={cn(available === false && state === "READY" && "opacity-70", className)}>
      {icon}
      {PRINTER_STATE_LABEL[state]}
    </Badge>
  );
}

export function OnlineDot({ online, label }: { online: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={cn("size-2 rounded-full", online ? "bg-success" : "bg-line-strong")} aria-hidden />
      {label ?? (online ? "Online" : "Offline")}
    </span>
  );
}
