import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { JobStatusBadge } from "../shared/status";
import { formatJobNumber, timeAgo } from "@/lib/format";
import type { PrintJobDTO } from "@/lib/types";

/** Compact, tappable job row used on the dashboard and on mobile job lists. */
export function JobRow({ job }: { job: PrintJobDTO }) {
  return (
    <Link href={`/jobs/${job.id}`} className="flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-canvas sm:px-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-canvas text-muted ring-1 ring-inset ring-line">
        <FileText className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{job.documentName}</span>
        <span className="block truncate text-xs text-muted">
          {formatJobNumber(job.jobNumber)} · {job.printer.name} · {job.totalPages} {job.totalPages === 1 ? "page" : "pages"} · {timeAgo(job.createdAt)}
        </span>
      </span>
      <JobStatusBadge status={job.status} cancelRequested={job.cancelRequested} />
      <ChevronRight className="hidden size-4 text-subtle sm:block" aria-hidden />
    </Link>
  );
}
