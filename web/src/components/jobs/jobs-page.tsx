"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { History, Search } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { EmptyState, ErrorState, PageHeader } from "../shared/states";
import { JobStatusBadge } from "../shared/status";
import { JobActions } from "./job-actions";
import { JobRow } from "./job-row";
import { useJobsInfinite, usePrinters } from "@/hooks/use-api";
import { errorMessage } from "@/lib/api-client";
import { formatDateTime, formatJobNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const FILTERS = [
  { label: "All", value: "" },
  { label: "Active", value: "UPLOADED,QUEUED,PROCESSING,PRINTING" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Failed", value: "FAILED" },
  { label: "Cancelled", value: "CANCELLED" },
];

export function JobsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const status = params.get("status") ?? "";
  const printerId = params.get("printerId") ?? "";
  const [q, setQ] = React.useState(params.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = React.useState(q);
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const printers = usePrinters();
  const jobs = useJobsInfinite({ status, printerId, q: debouncedQ });
  const items = jobs.data?.flatMap((p) => p.items) ?? [];
  const hasMore = !!jobs.data?.at(-1)?.nextCursor;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/jobs${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  return (
    <>
      <PageHeader title="Print jobs" description="Every job, its status from the Windows spooler, and what went wrong if it failed." />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              role="tab"
              aria-selected={status === f.value}
              onClick={() => setParam("status", f.value)}
              className={cn(
                "h-9 shrink-0 rounded-full px-4 text-sm font-medium transition-colors",
                status === f.value ? "bg-ink text-white" : "bg-surface text-ink-soft ring-1 ring-inset ring-line hover:bg-canvas",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-1 gap-2 lg:justify-end">
          <div className="relative flex-1 lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input aria-label="Search documents" placeholder="Search document name" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {(printers.data?.printers.length ?? 0) > 1 && (
            <Select value={printerId || "all"} onValueChange={(v) => setParam("printerId", v === "all" ? "" : v)}>
              <SelectTrigger className="w-44" aria-label="Filter by printer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All printers</SelectItem>
                {printers.data?.printers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {jobs.error && <ErrorState message={errorMessage(jobs.error)} onRetry={() => jobs.mutate()} />}
      {!jobs.data && !jobs.error && <Skeleton className="h-80" />}
      {jobs.data && items.length === 0 && (
        <EmptyState
          icon={<History />}
          title={status || printerId || debouncedQ ? "No jobs match these filters" : "No print jobs yet"}
          description={status || printerId || debouncedQ ? "Try a different filter." : "Upload a document to send your first job."}
          action={
            !status && !printerId && !debouncedQ ? (
              <Button asChild>
                <Link href="/upload">Upload a document</Link>
              </Button>
            ) : undefined
          }
        />
      )}

      {items.length > 0 && (
        <>
          {/* Mobile: cards */}
          <Card className="divide-y divide-line px-2 md:hidden">
            {items.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </Card>

          {/* Desktop: table */}
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas/70 text-left text-xs font-medium text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Job</th>
                  <th className="px-4 py-3 font-medium">Document</th>
                  <th className="px-4 py-3 font-medium">Printer</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 text-right font-medium">Pages</th>
                  <th className="px-4 py-3 text-right font-medium">Copies</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((j) => (
                  <tr key={j.id} className="group hover:bg-canvas/60">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted">
                      <Link href={`/jobs/${j.id}`} className="hover:text-accent">
                        {formatJobNumber(j.jobNumber)}
                      </Link>
                    </td>
                    <td className="max-w-64 px-4 py-3">
                      <Link href={`/jobs/${j.id}`} className="block truncate font-medium text-ink hover:text-accent">
                        {j.documentName}
                      </Link>
                      {j.status === "FAILED" && j.errorMessage && <p className="truncate text-xs text-danger">{j.errorMessage}</p>}
                      {j.isTest && <p className="text-xs text-muted">Test page</p>}
                    </td>
                    <td className="max-w-40 truncate px-4 py-3 text-ink-soft">{j.printer.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{formatDateTime(j.createdAt)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{j.pagesSelected}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{j.copies}</td>
                    <td className="px-4 py-3">
                      <JobStatusBadge status={j.status} cancelRequested={j.cancelRequested} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        <JobActions job={j} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {hasMore && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" loading={jobs.isValidating} onClick={() => jobs.setSize(jobs.size + 1)}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
