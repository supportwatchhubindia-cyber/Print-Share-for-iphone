"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Activity,
  CircleAlert,
  CircleCheck,
  CircleX,
  CreditCard,
  HardDrive,
  Laptop,
  MoreHorizontal,
  Printer,
  Search,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../ui/misc";
import { ConfirmDialog } from "../ui/dialog";
import { ErrorState, PageHeader } from "../shared/states";
import { OnlineDot, PrinterStateBadge } from "../shared/status";
import { apiFetch, errorMessage, fetcher } from "@/lib/api-client";
import { PLANS } from "@/lib/plans";
import { SUBSCRIPTION_PLANS, type SubscriptionPlan } from "@/lib/constants";
import { formatBytes, formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PrinterDTO } from "@/lib/types";

type Stats = {
  users: number;
  printers: number;
  activeBridges: number;
  totalBridges: number;
  jobs: number;
  failedJobs: number;
  completedJobs: number;
  jobsLast24h: number;
  documentsStored: number;
  storageBytes: number;
  plans: Record<SubscriptionPlan, number>;
};
type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  plan: SubscriptionPlan;
  printers: number;
  jobs: number;
  createdAt: string;
  lastLoginAt: string | null;
};
type AdminBridge = { id: string; name: string; ownerEmail: string; os: string | null; appVersion: string | null; online: boolean; status: string; lastSeenAt: string | null; lastIp: string | null; printers: number };
type Health = {
  health: { checks: { name: string; status: "ok" | "warn" | "error"; detail: string }[]; process: { uptimeSeconds: number; nodeVersion: string; rssMb: number; heapUsedMb: number } };
  auditLogs: { id: string; action: string; actorType: string; userEmail: string | null; targetType: string | null; ipAddress: string | null; createdAt: string }[];
};

function Tile({ label, value, sub, icon, tone }: { label: string; value: React.ReactNode; sub?: string; icon: React.ReactNode; tone?: "danger" }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between text-muted">
        <span className="text-[13px] font-medium">{label}</span>
        <span className={cn("[&_svg]:size-4", tone === "danger" && "text-danger")}>{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

export function AdminPage({ currentUserId }: { currentUserId: string }) {
  const stats = useSWR<{ stats: Stats }>("/api/admin/stats", fetcher, { refreshInterval: 30_000 });
  const s = stats.data?.stats;
  return (
    <>
      <PageHeader title="Administration" description="Users, printers, subscriptions and system health." />
      {stats.error && <ErrorState message={errorMessage(stats.error)} onRetry={() => stats.mutate()} className="mb-6" />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {s ? (
          <>
            <Tile label="Users" value={s.users.toLocaleString()} icon={<Users />} />
            <Tile label="Printers" value={s.printers.toLocaleString()} icon={<Printer />} />
            <Tile label="Active bridges" value={`${s.activeBridges}/${s.totalBridges}`} icon={<Laptop />} />
            <Tile label="Print jobs" value={s.jobs.toLocaleString()} sub={`${s.jobsLast24h} in last 24 h`} icon={<Activity />} />
            <Tile label="Failed jobs" value={s.failedJobs.toLocaleString()} sub={s.jobs ? `${((s.failedJobs / s.jobs) * 100).toFixed(1)}% of all` : undefined} icon={<CircleX />} tone={s.failedJobs ? "danger" : undefined} />
            <Tile label="Storage" value={formatBytes(s.storageBytes)} sub={`${s.documentsStored} live documents`} icon={<HardDrive />} />
          </>
        ) : (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28" />)
        )}
      </div>

      <Tabs defaultValue="users" className="mt-8">
        <TabsList>
          <TabsTrigger value="users">
            <Users /> Users
          </TabsTrigger>
          <TabsTrigger value="printers">
            <Printer /> Printers
          </TabsTrigger>
          <TabsTrigger value="subscriptions">
            <CreditCard /> Subscriptions
          </TabsTrigger>
          <TabsTrigger value="health">
            <ShieldCheck /> System health
          </TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UsersPanel currentUserId={currentUserId} onChange={() => stats.mutate()} />
        </TabsContent>
        <TabsContent value="printers">
          <PrintersPanel />
        </TabsContent>
        <TabsContent value="subscriptions">
          <Card>
            <CardHeader>
              <CardTitle>Subscriptions</CardTitle>
              <CardDescription>Change a user&apos;s plan from the Users tab. Payment collection is not connected.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              {SUBSCRIPTION_PLANS.map((p) => (
                <div key={p} className="rounded-2xl bg-canvas p-4 ring-1 ring-inset ring-line">
                  <p className="text-sm font-medium">{PLANS[p].name}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{s?.plans[p] ?? "—"}</p>
                  <p className="text-xs text-muted">
                    {PLANS[p].monthlyPageLimit.toLocaleString()} pages · {PLANS[p].maxPrinters} printers
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="health">
          <HealthPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}

function UsersPanel({ currentUserId, onChange }: { currentUserId: string; onChange: () => void }) {
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const users = useSWR<{ users: AdminUser[] }>(`/api/admin/users${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`, fetcher);

  const update = async (u: AdminUser, body: Record<string, string>, success: string) => {
    try {
      await apiFetch(`/api/admin/users/${u.id}`, { method: "PATCH", json: body });
      toast.success(success);
      await users.mutate();
      onChange();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Users</CardTitle>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input aria-label="Search users" placeholder="Search name or email" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0 sm:px-0">
        {users.error && <ErrorState message={errorMessage(users.error)} className="mx-5" />}
        {!users.data && !users.error && <Skeleton className="mx-5 h-40" />}
        {users.data && (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-y border-line bg-canvas/70 text-left text-xs text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">User</th>
                <th className="px-3 py-2.5 font-medium">Plan</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Printers</th>
                <th className="px-3 py-2.5 text-right font-medium">Jobs</th>
                <th className="px-3 py-2.5 font-medium">Joined</th>
                <th className="px-3 py-2.5 font-medium">Last login</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.data.users.map((u) => (
                <tr key={u.id}>
                  <td className="px-5 py-3">
                    <p className="flex items-center gap-2 font-medium">
                      {u.name} {u.role === "ADMIN" && <Badge tone="accent">Admin</Badge>}
                    </p>
                    <p className="text-xs text-muted">{u.email}</p>
                  </td>
                  <td className="px-3 py-3">{PLANS[u.plan].name}</td>
                  <td className="px-3 py-3">{u.status === "ACTIVE" ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Suspended</Badge>}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{u.printers}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{u.jobs}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink-soft">{formatDate(u.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink-soft">{timeAgo(u.lastLoginAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Manage ${u.email}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuLabel>Plan</DropdownMenuLabel>
                        {SUBSCRIPTION_PLANS.map((p) => (
                          <DropdownMenuItem key={p} disabled={p === u.plan} onSelect={() => update(u, { plan: p }, `${u.email} moved to ${PLANS[p].name}`)}>
                            {p === u.plan ? <CircleCheck /> : <CreditCard />} {PLANS[p].name}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        {u.id !== currentUserId && (
                          <>
                            <DropdownMenuItem onSelect={() => update(u, { role: u.role === "ADMIN" ? "USER" : "ADMIN" }, "Role updated")}>
                              <ShieldCheck /> {u.role === "ADMIN" ? "Remove admin" : "Make admin"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              destructive={u.status === "ACTIVE"}
                              onSelect={() => update(u, { status: u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }, u.status === "ACTIVE" ? "User suspended and signed out" : "User reactivated")}
                            >
                              <CircleAlert /> {u.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function PrintersPanel() {
  const data = useSWR<{ printers: (PrinterDTO & { ownerEmail: string })[]; bridges: AdminBridge[] }>("/api/admin/printers", fetcher, { refreshInterval: 30_000 });
  const [pending, setPending] = React.useState<{ kind: "printer" | "bridge"; id: string; label: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  if (data.error) return <ErrorState message={errorMessage(data.error)} onRetry={() => data.mutate()} />;
  if (!data.data) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Printers</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0 sm:px-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-y border-line bg-canvas/70 text-left text-xs text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">Printer</th>
                <th className="px-3 py-2.5 font-medium">Owner</th>
                <th className="px-3 py-2.5 font-medium">Bridge</th>
                <th className="px-3 py-2.5 font-medium">State</th>
                <th className="px-3 py-2.5 font-medium">Last connected</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.data.printers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-muted">
                    No printers registered.
                  </td>
                </tr>
              )}
              {data.data.printers.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted">
                      {p.modelName} · {p.connection} {p.portName ? `(${p.portName})` : ""}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-ink-soft">{p.ownerEmail}</td>
                  <td className="px-3 py-3">{p.bridge ? <OnlineDot online={p.bridge.online} label={p.bridge.name} /> : "—"}</td>
                  <td className="px-3 py-3">
                    <PrinterStateBadge state={p.state} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink-soft">{timeAgo(p.lastConnectedAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <Button variant="destructive-ghost" size="sm" onClick={() => setPending({ kind: "printer", id: p.id, label: p.name })}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bridges</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0 sm:px-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-y border-line bg-canvas/70 text-left text-xs text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">Computer</th>
                <th className="px-3 py-2.5 font-medium">Owner</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Version</th>
                <th className="px-3 py-2.5 font-medium">Last seen</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.data.bridges.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-muted">
                    No bridges paired.
                  </td>
                </tr>
              )}
              {data.data.bridges.map((b) => (
                <tr key={b.id}>
                  <td className="px-5 py-3">
                    <p className="font-medium">{b.name}</p>
                    <p className="text-xs text-muted">
                      {b.os ?? "Windows"} · {b.printers} printer{b.printers === 1 ? "" : "s"} {b.lastIp ? `· ${b.lastIp}` : ""}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-ink-soft">{b.ownerEmail}</td>
                  <td className="px-3 py-3">
                    <OnlineDot online={b.online} label={b.online ? (b.status === "PAUSED" ? "Paused" : "Online") : "Offline"} />
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">{b.appVersion ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink-soft">{timeAgo(b.lastSeenAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <Button variant="destructive-ghost" size="sm" onClick={() => setPending({ kind: "bridge", id: b.id, label: b.name })}>
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === "bridge" ? `Revoke bridge ${pending?.label}?` : `Remove printer ${pending?.label}?`}
        description={
          pending?.kind === "bridge"
            ? "The bridge's credentials stop working immediately and its queued jobs fail. The owner must pair it again."
            : "Queued jobs for this printer are cancelled. The owner can register it again from their bridge."
        }
        confirmLabel={pending?.kind === "bridge" ? "Revoke" : "Remove"}
        destructive
        loading={busy}
        onConfirm={async () => {
          if (!pending) return;
          setBusy(true);
          try {
            await apiFetch(pending.kind === "bridge" ? `/api/admin/bridges/${pending.id}` : `/api/admin/printers/${pending.id}`, { method: "DELETE" });
            toast.success("Done");
            await data.mutate();
            setPending(null);
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function HealthPanel() {
  const data = useSWR<Health>("/api/admin/health", fetcher, { refreshInterval: 30_000 });
  if (data.error) return <ErrorState message={errorMessage(data.error)} onRetry={() => data.mutate()} />;
  if (!data.data) return <Skeleton className="h-64" />;
  const { checks, process } = data.data.health;
  const icon = { ok: <CircleCheck className="size-5 text-success" />, warn: <TriangleAlert className="size-5 text-warning" />, error: <CircleX className="size-5 text-danger" /> };
  const label = { ok: "Healthy", warn: "Warning", error: "Error" };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Checks</CardTitle>
          <CardDescription>
            Up {Math.floor(process.uptimeSeconds / 3600)} h {Math.floor((process.uptimeSeconds % 3600) / 60)} m · Node {process.nodeVersion} · {process.rssMb} MB RSS
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-line">
            {checks.map((c) => (
              <li key={c.name} className="flex items-start gap-3 py-3">
                <span aria-hidden>{icon[c.status]}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {c.name} <span className="sr-only">— {label[c.status]}</span>
                  </p>
                  <p className="break-words text-xs text-muted">{c.detail}</p>
                </div>
                <Badge tone={c.status === "ok" ? "success" : c.status === "warn" ? "warning" : "danger"}>{label[c.status]}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>Most recent security-relevant events</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
            {data.data.auditLogs.map((l) => (
              <li key={l.id} className="text-sm">
                <p className="font-mono text-xs text-ink">{l.action}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(l.createdAt)} · {l.actorType.toLowerCase()}
                  {l.userEmail ? ` · ${l.userEmail}` : ""}
                  {l.ipAddress ? ` · ${l.ipAddress}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
