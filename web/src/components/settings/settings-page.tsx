"use client";

import * as React from "react";
import { toast } from "sonner";
import { LogOut, MonitorSmartphone, Smartphone } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Progress, Skeleton } from "../ui/misc";
import { ErrorState, PageHeader } from "../shared/states";
import { InstallPrompt } from "../pwa/pwa";
import { useMe, useSessions } from "@/hooks/use-api";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { PLANS, formatPrice } from "@/lib/plans";
import { formatDate, timeAgo } from "@/lib/format";

export function SettingsPage() {
  const me = useMe();
  const sessions = useSessions();
  const [revoking, setRevoking] = React.useState<string | null>(null);
  const plan = me.data ? PLANS[me.data.subscription.plan] : null;

  return (
    <>
      <PageHeader title="Settings" description="Your account, plan and signed-in devices." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            {me.error && <ErrorState message={errorMessage(me.error)} onRetry={() => me.mutate()} />}
            {me.data ? (
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Name</dt>
                  <dd className="font-medium">{me.data.user.name}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Email</dt>
                  <dd className="truncate font-medium">{me.data.user.email}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Member since</dt>
                  <dd className="font-medium">{formatDate(me.data.user.createdAt)}</dd>
                </div>
                {me.data.user.role === "ADMIN" && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Role</dt>
                    <dd>
                      <Badge tone="accent">Administrator</Badge>
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              !me.error && <Skeleton className="h-24" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plan & usage</CardTitle>
            <CardDescription>Plans are managed by your administrator.</CardDescription>
          </CardHeader>
          <CardContent>
            {me.data && plan ? (
              <div className="space-y-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-semibold">{plan.name}</span>
                  <span className="text-sm text-muted">
                    {formatPrice(plan)}
                    {plan.priceMonthly > 0 && " / month"}
                  </span>
                </div>
                <div>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="text-muted">Pages this month</span>
                    <span className="font-medium tabular-nums">
                      {me.data.usage.pagesUsed.toLocaleString()} / {me.data.usage.pageLimit.toLocaleString()}
                    </span>
                  </div>
                  <Progress value={(me.data.usage.pagesUsed / Math.max(1, me.data.usage.pageLimit)) * 100} label="Monthly page usage" />
                </div>
                <p className="text-sm text-muted">Up to {plural(plan.maxPrinters)}.</p>
              </div>
            ) : (
              <Skeleton className="h-24" />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Signed-in devices</CardTitle>
            <CardDescription>Sign out anything you don&apos;t recognise.</CardDescription>
          </CardHeader>
          <CardContent>
            {sessions.error && <ErrorState message={errorMessage(sessions.error)} onRetry={() => sessions.mutate()} />}
            {!sessions.data && !sessions.error && <Skeleton className="h-32" />}
            <ul className="divide-y divide-line">
              {sessions.data?.sessions.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-canvas text-muted ring-1 ring-inset ring-line">
                    {/iPhone|Android|iPad/.test(s.deviceLabel) ? <Smartphone className="size-5" /> : <MonitorSmartphone className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {s.deviceLabel}
                      {s.current && <Badge tone="success">This device</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      Active {timeAgo(s.lastSeenAt)} · signed in {formatDate(s.createdAt)}
                      {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                    </p>
                  </div>
                  {s.current ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
                        window.location.assign("/login");
                      }}
                    >
                      <LogOut /> Sign out
                    </Button>
                  ) : (
                    <Button
                      variant="destructive-ghost"
                      size="sm"
                      loading={revoking === s.id}
                      onClick={async () => {
                        setRevoking(s.id);
                        try {
                          await apiFetch(`/api/auth/sessions/${s.id}`, { method: "DELETE" });
                          toast.success("Device signed out");
                          await sessions.mutate();
                        } catch (err) {
                          toast.error(errorMessage(err));
                        } finally {
                          setRevoking(null);
                        }
                      }}
                    >
                      Sign out
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <InstallPrompt />
        </div>
      </div>
    </>
  );
}

function plural(n: number) {
  return `${n} printer${n === 1 ? "" : "s"}`;
}
