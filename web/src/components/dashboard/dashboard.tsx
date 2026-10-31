"use client";

import Link from "next/link";
import { CircleCheck, History, Plus, Printer, TriangleAlert, Upload, Usb } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Progress, Skeleton } from "../ui/misc";
import { EmptyState, ErrorState } from "../shared/states";
import { OnlineDot, PrinterStateBadge } from "../shared/status";
import { InstallPrompt } from "../pwa/pwa";
import { JobRow } from "../jobs/job-row";
import { UsageChart } from "./usage-chart";
import { useMe, usePrinters, useRecentJobs } from "@/hooks/use-api";
import { errorMessage } from "@/lib/api-client";
import { PLANS } from "@/lib/plans";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Stat({ label, value, sub, icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon: React.ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between text-muted">
        <span className="text-[13px] font-medium">{label}</span>
        <span className="[&_svg]:size-4">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export function Dashboard() {
  const me = useMe();
  const printers = usePrinters();
  const jobs = useRecentJobs(5);

  const usage = me.data?.usage;
  const pct = usage ? (usage.pagesUsed / Math.max(1, usage.pageLimit)) * 100 : 0;
  const firstName = me.data?.user.name.split(" ")[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted" suppressHydrationWarning>
            {greeting()}
            {firstName ? "," : ""}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {firstName ?? <span className="inline-block h-8 w-40 animate-pulse-soft rounded-xl bg-canvas align-middle" aria-hidden />}
          </h1>
        </div>
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link href="/upload">
            <Upload /> Upload & print
          </Link>
        </Button>
      </div>

      <InstallPrompt />

      {me.error && <ErrorState message={errorMessage(me.error)} onRetry={() => me.mutate()} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {usage ? (
          <>
            <Card className="col-span-2 p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-muted">Pages this month</span>
                <span className="text-xs text-muted">{me.data ? PLANS[me.data.subscription.plan].name : ""} plan</span>
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold tracking-tight tabular-nums">{usage.pagesUsed.toLocaleString()}</span>
                <span className="text-sm text-muted">/ {usage.pageLimit.toLocaleString()}</span>
              </div>
              <Progress className="mt-3" value={pct} tone={pct >= 100 ? "danger" : pct >= 80 ? "warning" : "accent"} label="Monthly page usage" />
              <p className="mt-2 text-xs text-muted">
                {Math.max(0, usage.pageLimit - usage.pagesUsed).toLocaleString()} pages left · resets{" "}
                {new Date(usage.periodEnd).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </p>
            </Card>
            <Stat label="Completed" value={usage.completedJobs} sub={`of ${usage.jobsThisPeriod} jobs this month`} icon={<CircleCheck />} />
            <Stat
              label={usage.failedJobs ? "Failed" : "In progress"}
              value={usage.failedJobs || usage.activeJobs}
              sub={usage.failedJobs ? <Link href="/jobs?status=FAILED" className="text-accent hover:underline">Review failed jobs</Link> : "jobs printing or queued"}
              icon={usage.failedJobs ? <TriangleAlert /> : <History />}
            />
          </>
        ) : (
          <>
            <Skeleton className="col-span-2 h-[132px]" />
            <Skeleton className="h-[132px]" />
            <Skeleton className="h-[132px]" />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Printers</CardTitle>
              <CardDescription>Availability right now</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/printers">Manage</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {printers.error && <ErrorState message={errorMessage(printers.error)} onRetry={() => printers.mutate()} />}
            {!printers.data && !printers.error && [0, 1].map((i) => <Skeleton key={i} className="h-16" />)}
            {printers.data?.printers.length === 0 && (
              <EmptyState
                icon={<Usb />}
                title="No printer connected"
                description="Install PrintShare Bridge on the Windows PC your USB printer is plugged into."
                action={
                  <Button asChild size="sm">
                    <Link href="/printers">
                      <Plus /> Connect a printer
                    </Link>
                  </Button>
                }
              />
            )}
            {printers.data?.printers.map((p) => (
              <Link key={p.id} href="/printers" className="flex items-center gap-3 rounded-xl border border-line p-3 transition-colors hover:bg-canvas">
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Printer className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted">
                    <OnlineDot online={!!p.bridge?.online} label={p.bridge ? `${p.bridge.name}` : "No bridge"} />
                  </span>
                </span>
                <PrinterStateBadge state={p.state} available={p.available} />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent print jobs</CardTitle>
              <CardDescription>Updates live as your printer works</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/jobs">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="-mx-2 sm:-mx-3">
            {jobs.error && <ErrorState message={errorMessage(jobs.error)} onRetry={() => jobs.mutate()} className="mx-2" />}
            {!jobs.data && !jobs.error && [0, 1, 2].map((i) => <Skeleton key={i} className="mx-2 mb-2 h-14" />)}
            {jobs.data?.items.length === 0 && (
              <EmptyState className="mx-2" icon={<History />} title="No print jobs yet" description="Upload a document and pick a printer to get started." />
            )}
            <div className="divide-y divide-line">
              {jobs.data?.items.map((j) => <JobRow key={j.id} job={j} />)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Print usage</CardTitle>
          <CardDescription>Pages printed per day, last 14 days</CardDescription>
        </CardHeader>
        <CardContent>{usage ? <UsageChart days={usage.daily} /> : <Skeleton className="h-44" />}</CardContent>
      </Card>
    </div>
  );
}
