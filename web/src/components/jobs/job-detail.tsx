"use client";

import Link from "next/link";
import { ArrowLeft, Check, CircleAlert, FileExclamationPoint, Printer, TriangleAlert } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Skeleton } from "../ui/misc";
import { EmptyState, ErrorState, Notice } from "../shared/states";
import { JobStatusBadge } from "../shared/status";
import { JobActions } from "./job-actions";
import { useJob } from "@/hooks/use-api";
import { ApiClientError, errorMessage } from "@/lib/api-client";
import { PAPER_SIZE_INFO, PRINT_QUALITY_INFO, type PrintJobStatus } from "@/lib/constants";
import { JOB_STATUS_HINT, JOB_STATUS_LABEL } from "@/lib/printing/transitions";
import { formatDateTime, formatJobNumber, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PrintJobDetailDTO } from "@/lib/types";

const STEPS: PrintJobStatus[] = ["UPLOADED", "QUEUED", "PROCESSING", "PRINTING", "COMPLETED"];

function Tracker({ job }: { job: PrintJobDetailDTO }) {
  const failed = job.status === "FAILED" || job.status === "CANCELLED";
  // For failed/cancelled jobs, show progress up to the last state reached.
  const reached = failed
    ? Math.max(0, ...job.events.map((e) => (e.status ? STEPS.indexOf(e.status) : -1)))
    : STEPS.indexOf(job.status);
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Job progress">
      {STEPS.map((s, i) => {
        const done = i < reached || (i === reached && job.status === "COMPLETED");
        const current = i === reached && !done;
        return (
          <li key={s} className="flex flex-col gap-2" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "h-1.5 rounded-full",
                done ? "bg-accent" : current ? (failed ? "bg-danger" : "animate-pulse-soft bg-accent") : "bg-line",
              )}
            />
            <span className={cn("flex items-center gap-1 text-[11px] font-medium sm:text-xs", done || current ? "text-ink" : "text-subtle")}>
              {done && <Check className="hidden size-3.5 text-accent sm:block" aria-hidden />}
              {JOB_STATUS_LABEL[s]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function JobDetail({ id }: { id: string }) {
  const { data, error, mutate } = useJob(id);

  if (error) {
    return error instanceof ApiClientError && error.status === 404 ? (
      <EmptyState icon={<FileExclamationPoint />} title="Job not found" action={<Button asChild><Link href="/jobs">All jobs</Link></Button>} />
    ) : (
      <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />
    );
  }
  if (!data) return <Skeleton className="h-[480px]" />;
  const job = data.job;

  const details: [string, React.ReactNode][] = [
    ["Printer", `${job.printer.name} · ${job.printer.modelName}`],
    ["Pages", job.pageRange ? `${job.pageRange} (${plural(job.pagesSelected, "page")} of ${job.documentPages})` : `All ${job.documentPages}`],
    ["Copies", job.copies],
    ["Total", plural(job.totalPages, "page")],
    ["Paper", PAPER_SIZE_INFO[job.paperSize].label],
    ["Orientation", job.orientation === "PORTRAIT" ? "Portrait" : "Landscape"],
    ["Colour", job.colorMode === "COLOR" ? "Colour" : "Black & white"],
    ["Sides", job.duplex === "SIMPLEX" ? "Single-sided" : job.duplex === "LONG_EDGE" ? "Double, long edge" : "Double, short edge"],
    ["Quality", `${PRINT_QUALITY_INFO[job.quality].label} (${PRINT_QUALITY_INFO[job.quality].dpi} dpi)`],
    ["Scaling", job.scaleMode === "FIT" ? "Fit to page" : "Actual size"],
    ["Attempt", job.attempt],
    ["Windows job", job.spoolJobId != null ? `#${job.spoolJobId}` : "—"],
    ["Submitted", formatDateTime(job.createdAt)],
    ["Completed", formatDateTime(job.completedAt)],
  ];

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/jobs">
          <ArrowLeft /> Print jobs
        </Link>
      </Button>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted">
              Job {formatJobNumber(job.jobNumber)}
              {job.isTest && " · Test page"}
            </p>
            <h1 className="mt-1 truncate text-xl font-semibold tracking-tight sm:text-2xl">{job.documentName}</h1>
            <p className="mt-1 text-sm text-muted">{job.cancelRequested && job.canCancel === false && job.status !== "CANCELLED" ? "Waiting for the bridge to confirm cancellation" : JOB_STATUS_HINT[job.status]}</p>
          </div>
          <JobStatusBadge status={job.status} cancelRequested={job.cancelRequested} className="self-start px-3 py-1 text-sm" />
        </div>

        <div className="mt-6">
          <Tracker job={job} />
        </div>

        {job.printerAlert && job.status === "PRINTING" && (
          <Notice tone="warning" icon={<TriangleAlert />} title="Printer needs attention" className="mt-5">
            {job.printerAlert}. Printing resumes automatically once it&apos;s fixed.
          </Notice>
        )}
        {job.status === "FAILED" && (
          <Notice tone="danger" icon={<CircleAlert />} title="Why it failed" className="mt-5">
            {job.errorMessage ?? "The printer reported an error."}
            {job.errorCode && <span className="ml-1 font-mono text-xs text-muted">({job.errorCode})</span>}
            {job.errorCode === "OUTCOME_UNKNOWN" && <p className="mt-1">Check the printer output before retrying to avoid a duplicate print.</p>}
            {!job.documentAvailable && <p className="mt-1">The document has expired, so upload it again to retry.</p>}
          </Notice>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <JobActions job={job} size="default" />
          {job.status === "COMPLETED" && job.documentAvailable && job.documentId && (
            <Button asChild variant="secondary">
              <Link href={`/documents/${job.documentId}`}>
                <Printer /> Print again
              </Link>
            </Button>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              {details.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="mt-0.5 font-medium text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-4 border-l border-line pl-5">
              {data.job.events.map((e) => (
                <li key={e.id} className="relative">
                  <span
                    className={cn(
                      "absolute -left-[25px] top-1 size-2.5 rounded-full ring-4 ring-surface",
                      e.type === "failed" ? "bg-danger" : e.type === "completed" ? "bg-success" : e.type.startsWith("printer_alert") ? "bg-warning" : "bg-accent",
                    )}
                    aria-hidden
                  />
                  <p className="text-sm text-ink">{e.message}</p>
                  <p className="text-xs text-muted">
                    {formatDateTime(e.createdAt)} · {e.source === "BRIDGE" ? "Windows bridge" : e.source === "USER" ? "You" : "PrintShare"}
                  </p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
