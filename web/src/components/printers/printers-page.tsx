"use client";

import * as React from "react";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import {
  Cable,
  CircleCheck,
  Laptop,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Smartphone,
  Trash2,
  TriangleAlert,
  Unplug,
  Usb,
} from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Skeleton } from "../ui/misc";
import { EmptyState, ErrorState, PageHeader } from "../shared/states";
import { OnlineDot, PrinterStateBadge } from "../shared/status";
import { PairBridgeDialog } from "./pair-bridge-dialog";
import { RegisterPrinterDialog } from "./register-printer-dialog";
import { useBridges, usePrinters } from "@/hooks/use-api";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { PAPER_SIZE_INFO } from "@/lib/constants";
import { formatDateTime, timeAgo } from "@/lib/format";
import type { BridgeDTO, PrinterDTO, PrintJobDTO } from "@/lib/types";

export function PrintersPage({ bridgeDownloadUrl }: { bridgeDownloadUrl: string | null }) {
  const printers = usePrinters();
  const bridges = useBridges();
  const [pairOpen, setPairOpen] = React.useState(false);
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const hasBridge = (bridges.data?.bridges.length ?? 0) > 0;
  const unregistered = bridges.data?.bridges.flatMap((b) => b.detectedPrinters.filter((p) => !p.registeredPrinterId)).length ?? 0;

  const addPrinter = () => (hasBridge ? setRegisterOpen(true) : setPairOpen(true));

  return (
    <>
      <PageHeader
        title="Printers"
        description="USB printers shared from your Windows computers through PrintShare Bridge."
        actions={
          <>
            <Button variant="secondary" onClick={() => setPairOpen(true)}>
              <Laptop /> Connect computer
            </Button>
            <Button onClick={addPrinter}>
              <Plus /> Add printer
            </Button>
          </>
        }
      />

      {unregistered > 0 && (
        <button onClick={() => setRegisterOpen(true)} className="mb-6 flex w-full items-center gap-3 rounded-2xl border border-accent/20 bg-accent-soft p-4 text-left text-sm transition-colors hover:bg-[#e4edff]">
          <Printer className="size-5 text-accent" aria-hidden />
          <span className="flex-1 text-accent-ink">
            <span className="font-semibold">{unregistered} printer{unregistered === 1 ? "" : "s"} detected</span> on your bridge — register to start printing.
          </span>
          <span className="font-medium text-accent">Register</span>
        </button>
      )}

      <section className="space-y-4" aria-labelledby="printers-heading">
        <h2 id="printers-heading" className="sr-only">
          Registered printers
        </h2>
        {printers.error && <ErrorState message={errorMessage(printers.error)} onRetry={() => printers.mutate()} />}
        {!printers.data && !printers.error && <Skeleton className="h-56" />}
        {printers.data?.printers.length === 0 && (
          <EmptyState
            icon={<Usb />}
            title="No printers yet"
            description={hasBridge ? "Your bridge is connected. Register the printer it detected." : "Connect the Windows PC your USB printer is plugged into to get started."}
            action={
              <Button onClick={addPrinter}>
                <Plus /> {hasBridge ? "Register printer" : "Connect a computer"}
              </Button>
            }
          />
        )}
        <div className="grid gap-4 xl:grid-cols-2">
          {printers.data?.printers.map((p) => <PrinterCard key={p.id} printer={p} />)}
        </div>
      </section>

      <section className="mt-10" aria-labelledby="bridges-heading">
        <h2 id="bridges-heading" className="mb-1 text-lg font-semibold tracking-tight">
          Windows bridges
        </h2>
        <p className="mb-4 text-sm text-muted">Computers running PrintShare Bridge. They connect out to this server — no ports are opened on your network.</p>
        {bridges.error && <ErrorState message={errorMessage(bridges.error)} onRetry={() => bridges.mutate()} />}
        {!bridges.data && !bridges.error && <Skeleton className="h-28" />}
        {bridges.data?.bridges.length === 0 && (
          <EmptyState icon={<Laptop />} title="No computers connected" action={<Button variant="secondary" onClick={() => setPairOpen(true)}>Connect computer</Button>} />
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {bridges.data?.bridges.map((b) => <BridgeCard key={b.id} bridge={b} />)}
        </div>
      </section>

      <HowItWorks />

      <PairBridgeDialog open={pairOpen} onOpenChange={setPairOpen} downloadUrl={bridgeDownloadUrl} />
      <RegisterPrinterDialog open={registerOpen} onOpenChange={setRegisterOpen} bridges={bridges.data?.bridges ?? []} />
    </>
  );
}

function CapabilityChips({ printer }: { printer: PrinterDTO }) {
  const c = printer.capabilities;
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tone="outline">{c.color ? "Colour" : "Black & white"}</Badge>
      <Badge tone="outline">{c.duplex ? "Double-sided" : "Single-sided"}</Badge>
      <Badge tone="outline">{c.paperSizes.map((p) => PAPER_SIZE_INFO[p].label.split(" ")[0]).join(" · ")}</Badge>
      <Badge tone="outline">{Math.max(...c.resolutionsDpi, 0) || 600} dpi</Badge>
    </div>
  );
}

function PrinterCard({ printer }: { printer: PrinterDTO }) {
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = React.useState<null | "test" | "reconnect" | "remove" | "rename">(null);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [newName, setNewName] = React.useState(printer.name);
  const refresh = () => mutate((k) => typeof k === "string" && (k.startsWith("/api/printers") || k.startsWith("/api/bridges") || k.startsWith("/api/print-jobs")));

  const run = async (kind: "test" | "reconnect" | "remove" | "rename", fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-4 p-5 sm:p-6">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Printer className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold">{printer.name}</h3>
            <PrinterStateBadge state={printer.state} available={printer.available} />
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">{printer.modelName}</p>
          {printer.stateMessage && printer.state !== "READY" && (
            <p className="mt-2 flex items-start gap-1.5 text-[13px] text-warning">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {printer.stateMessage}
            </p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${printer.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/jobs?printerId=${printer.id}`}>
                <ScrollText /> Job history
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setConfirmRemove(true)}>
              <Trash2 /> Remove printer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line px-5 py-4 text-sm sm:grid-cols-3 sm:px-6">
        <div>
          <dt className="text-xs text-muted">Connection</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
            {printer.connection === "USB" ? <Usb className="size-4 text-muted" /> : <Cable className="size-4 text-muted" />}
            {printer.connection === "USB" ? "USB" : printer.connection.toLowerCase()}
            {printer.portName && <span className="font-normal text-muted">({printer.portName})</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Driver</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
            {printer.driverStatus === "INSTALLED" ? <CircleCheck className="size-4 text-success" /> : <TriangleAlert className="size-4 text-warning" />}
            {printer.driverStatus === "INSTALLED" ? "Installed" : printer.driverStatus === "MISSING" ? "Missing" : "Unknown"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Bridge</dt>
          <dd className="mt-0.5">{printer.bridge ? <OnlineDot online={printer.bridge.online} label={printer.bridge.name} /> : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Last connected</dt>
          <dd className="mt-0.5 font-medium" title={formatDateTime(printer.lastConnectedAt)}>
            {timeAgo(printer.lastConnectedAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">In queue</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{printer.queuedJobs}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Hardware test</dt>
          <dd className="mt-0.5">
            {printer.verification === "VERIFIED" ? (
              <Badge tone="success">
                <ShieldCheck /> Verified
              </Badge>
            ) : (
              <Badge tone="neutral" title="This model has not yet passed the physical verification checklist.">
                Pending
              </Badge>
            )}
          </dd>
        </div>
      </dl>

      <div className="border-t border-line px-5 py-4 sm:px-6">
        <CapabilityChips printer={printer} />
      </div>

      <div className="mt-auto flex flex-wrap gap-2 border-t border-line px-5 py-4 sm:px-6">
        <Button
          variant="soft"
          size="sm"
          loading={busy === "test"}
          onClick={() =>
            run("test", async () => {
              const { job } = await apiFetch<{ job: PrintJobDTO }>(`/api/printers/${printer.id}/test`, { method: "POST" });
              toast.success("Test page queued", {
                description: printer.available ? "Watch it in Print jobs." : "It will print when the printer is back online.",
                action: { label: "View", onClick: () => window.location.assign(`/jobs/${job.id}`) },
              });
            })
          }
        >
          <Printer /> Test print
        </Button>
        <Button
          variant="secondary"
          size="sm"
          loading={busy === "reconnect"}
          onClick={() =>
            run("reconnect", async () => {
              await apiFetch(`/api/printers/${printer.id}/reconnect`, { method: "POST" });
              toast.success("Asked the bridge to re-check the printer");
            })
          }
        >
          <RefreshCw /> Reconnect
        </Button>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${printer.name}?`}
        description="Queued jobs for this printer are cancelled. Job history is kept. You can register it again from the bridge later."
        confirmLabel="Remove printer"
        destructive
        loading={busy === "remove"}
        onConfirm={() =>
          run("remove", async () => {
            await apiFetch(`/api/printers/${printer.id}`, { method: "DELETE" });
            toast.success("Printer removed");
            setConfirmRemove(false);
          })
        }
      />
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Rename printer</DialogTitle>
          </DialogHeader>
          <Field label="Name" htmlFor={`rename-${printer.id}`}>
            <Input id={`rename-${printer.id}`} value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy === "rename"}
              disabled={!newName.trim()}
              onClick={() =>
                run("rename", async () => {
                  await apiFetch(`/api/printers/${printer.id}`, { method: "PATCH", json: { name: newName.trim() } });
                  setRenameOpen(false);
                })
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function BridgeCard({ bridge }: { bridge: BridgeDTO }) {
  const { mutate } = useSWRConfig();
  const [confirm, setConfirm] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-canvas text-ink-soft ring-1 ring-inset ring-line">
          <Laptop className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold">{bridge.name}</p>
            {bridge.status === "PAUSED" && bridge.online ? <Badge tone="warning">Paused</Badge> : <OnlineDot online={bridge.online} />}
          </div>
          <p className="truncate text-xs text-muted">
            {bridge.os ?? "Windows"} · Bridge {bridge.appVersion ?? "?"} · seen {timeAgo(bridge.lastSeenAt)}
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            {bridge.detectedPrinters.length === 0
              ? "No printers shared yet."
              : bridge.detectedPrinters.map((p) => p.systemName).join(", ")}
          </p>
        </div>
        <Button variant="destructive-ghost" size="icon-sm" aria-label={`Disconnect ${bridge.name}`} onClick={() => setConfirm(true)}>
          <Unplug />
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Disconnect ${bridge.name}?`}
        description="Its credentials are revoked immediately and queued jobs for its printers fail. Pair it again to reconnect."
        confirmLabel="Disconnect"
        destructive
        loading={loading}
        onConfirm={async () => {
          setLoading(true);
          try {
            await apiFetch(`/api/bridges/${bridge.id}`, { method: "DELETE" });
            toast.success(`${bridge.name} disconnected`);
            await mutate((k) => typeof k === "string" && (k.startsWith("/api/bridges") || k.startsWith("/api/printers")));
            setConfirm(false);
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setLoading(false);
          }
        }}
      />
    </Card>
  );
}

function HowItWorks() {
  const steps = [
    { icon: <Smartphone />, title: "Your phone", text: "Upload from Safari, Chrome or the installed app." },
    { icon: <ShieldCheck />, title: "PrintShare server", text: "Converts to PDF, checks your printer's options, queues the job." },
    { icon: <Laptop />, title: "Windows bridge", text: "Pulls the job over HTTPS and prints with the HP driver." },
    { icon: <Usb />, title: "USB printer", text: "Windows confirms the job reached the printer." },
  ];
  return (
    <Card className="mt-10">
      <CardHeader>
        <CardTitle>How your print reaches a USB printer</CardTitle>
        <CardDescription>Browsers — including Safari on iPhone — cannot talk to USB printers directly, so the Windows bridge does that part.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-4 sm:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className="relative rounded-2xl bg-canvas p-4 ring-1 ring-inset ring-line">
              <span className="mb-3 flex size-9 items-center justify-center rounded-xl bg-surface text-accent shadow-soft [&_svg]:size-5">{s.icon}</span>
              <p className="text-sm font-semibold">
                {i + 1}. {s.title}
              </p>
              <p className="mt-1 text-xs text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
