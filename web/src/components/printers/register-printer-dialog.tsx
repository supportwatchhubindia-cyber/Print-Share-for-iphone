"use client";

import * as React from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Printer, Usb } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { PrinterStateBadge } from "../shared/status";
import { ApiClientError, apiFetch, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { BridgeDTO, DetectedPrinterDTO } from "@/lib/types";

type Candidate = { bridge: BridgeDTO; printer: DetectedPrinterDTO };

/** Lists printers reported by the user's bridges that are not registered yet. */
export function RegisterPrinterDialog({ open, onOpenChange, bridges }: { open: boolean; onOpenChange: (o: boolean) => void; bridges: BridgeDTO[] }) {
  const { mutate } = useSWRConfig();
  const candidates: Candidate[] = bridges.flatMap((bridge) =>
    bridge.detectedPrinters.filter((p) => !p.registeredPrinterId).map((printer) => ({ bridge, printer })),
  );
  // Most likely target first: the HP M1005, then USB printers, then the rest.
  candidates.sort((a, b) => rank(b.printer) - rank(a.printer));
  const [selected, setSelected] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | undefined>();
  const [saving, setSaving] = React.useState(false);
  const current = candidates.find((c) => key(c) === selected) ?? null;

  React.useEffect(() => {
    if (!open) return;
    const first = candidates[0];
    setSelected(first ? key(first) : null);
    setName(first ? defaultName(first.printer) : "");
    setError(undefined);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!current) return;
    setSaving(true);
    try {
      await apiFetch("/api/printers/register", {
        method: "POST",
        json: { bridgeId: current.bridge.id, systemName: current.printer.systemName, name: name.trim() },
      });
      toast.success(`${name.trim()} is ready`, { description: "Send a test page to confirm it prints." });
      await mutate((k) => typeof k === "string" && (k.startsWith("/api/printers") || k.startsWith("/api/bridges")));
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiClientError && err.fields?.name ? err.fields.name : errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register a printer</DialogTitle>
          <DialogDescription>Only printers your PrintShare Bridge actually detects on Windows are listed.</DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <div className="rounded-2xl bg-canvas p-5 text-sm text-muted ring-1 ring-inset ring-line">
            No unregistered printers reported. In PrintShare Bridge, open <span className="font-medium text-ink">Printers</span> and tick the printer to share. Make sure it appears in Windows <span className="font-medium text-ink">Settings → Printers &amp; scanners</span>.
          </div>
        ) : (
          <div className="space-y-4">
            <div role="radiogroup" aria-label="Detected printers" className="space-y-2">
              {candidates.map((c) => {
                const k = key(c);
                const active = k === selected;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setSelected(k);
                      setName(defaultName(c.printer));
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors",
                      active ? "border-accent bg-accent-soft/60 ring-2 ring-accent/20" : "border-line hover:bg-canvas",
                    )}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-accent ring-1 ring-line">
                      {c.printer.connection === "USB" ? <Usb className="size-5" /> : <Printer className="size-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.printer.systemName}</span>
                      <span className="block truncate text-xs text-muted">
                        {c.printer.modelName} · {c.printer.portName ?? "unknown port"} · on {c.bridge.name}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <PrinterStateBadge state={c.printer.state} />
                      {c.printer.modelKey === "HP_LJ_M1005" && <Badge tone="accent">Primary model</Badge>}
                    </span>
                  </button>
                );
              })}
            </div>
            <Field label="Display name" htmlFor="printer-name" error={error}>
              <Input id="printer-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} invalid={!!error} />
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!current || !name.trim()}>
            Register printer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const key = (c: Candidate) => `${c.bridge.id}::${c.printer.systemName}`;
const rank = (p: DetectedPrinterDTO) => (p.modelKey === "HP_LJ_M1005" ? 3 : p.connection === "USB" ? 2 : p.connection === "VIRTUAL" ? 0 : 1);
const defaultName = (p: DetectedPrinterDTO) => (p.modelKey === "HP_LJ_M1005" ? "HP LaserJet M1005" : p.systemName).slice(0, 80);
