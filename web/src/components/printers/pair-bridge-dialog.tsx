"use client";

import * as React from "react";
import { Check, Copy, Download, KeyRound, LoaderCircle, MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { useBridges } from "@/hooks/use-api";
import { apiFetch, errorMessage } from "@/lib/api-client";

function useCountdown(until: string | null) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const s = Math.max(0, Math.round((Date.parse(until) - now) / 1000));
  return { seconds: s, label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` };
}

/** Creates a one-time pairing code and waits for the Windows bridge to use it. */
export function PairBridgeDialog({
  open,
  onOpenChange,
  downloadUrl,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Present only when a built bridge package is published under /public/downloads. */
  downloadUrl: string | null;
}) {
  const [code, setCode] = React.useState<{ code: string; expiresAt: string } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const bridges = useBridges();
  const knownIds = React.useRef<Set<string> | null>(null);
  const countdown = useCountdown(code?.expiresAt ?? null);
  const serverUrl = typeof window !== "undefined" ? window.location.origin : "";

  React.useEffect(() => {
    if (open && bridges.data && !knownIds.current) knownIds.current = new Set(bridges.data.bridges.map((b) => b.id));
    if (!open) {
      knownIds.current = null;
      setCode(null);
    }
  }, [open, bridges.data]);

  // The realtime "bridge.updated" event refreshes the list; a new id means pairing succeeded.
  const paired = open && code && knownIds.current ? bridges.data?.bridges.find((b) => !knownIds.current!.has(b.id)) : undefined;
  React.useEffect(() => {
    if (paired) toast.success(`${paired.name} connected`, { description: "Now register the printer it found." });
  }, [paired]);

  async function generate() {
    setLoading(true);
    try {
      setCode(await apiFetch<{ code: string; expiresAt: string }>("/api/bridges/pairing-code", { method: "POST" }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a Windows computer</DialogTitle>
          <DialogDescription>The PC your USB printer is plugged into runs PrintShare Bridge and prints jobs through the installed HP driver.</DialogDescription>
        </DialogHeader>

        <ol className="space-y-4 text-sm">
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-ink">1</span>
            <div>
              <p className="font-medium">Install the printer driver and PrintShare Bridge on the PC</p>
              <p className="text-muted">Install the HP LaserJet M1005 driver, plug the printer in by USB and print a Windows test page. Then install and open PrintShare Bridge.</p>
              {downloadUrl ? (
                <a href={downloadUrl} download className="mt-1 inline-flex items-center gap-1 font-medium text-accent hover:underline">
                  <Download className="size-3.5" /> Download PrintShare Bridge for Windows
                </a>
              ) : (
                <p className="mt-1 text-xs text-muted">Ask your administrator for the PrintShare Bridge installer (built from the bridge-windows project).</p>
              )}
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-ink">2</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">In the bridge, enter this server address and pairing code</p>
              <code className="mt-1 block truncate rounded-lg bg-canvas px-2 py-1 font-mono text-xs ring-1 ring-inset ring-line">{serverUrl}</code>
              {code && countdown && countdown.seconds > 0 ? (
                <div className="mt-3 flex items-center gap-3 rounded-2xl bg-ink p-4 text-white">
                  <span className="flex-1 font-mono text-2xl font-semibold tracking-[0.2em] sm:text-3xl">{code.code}</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-white hover:bg-white/10 hover:text-white"
                    aria-label="Copy code"
                    onClick={async () => {
                      await navigator.clipboard?.writeText(code.code).catch(() => undefined);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </div>
              ) : (
                <Button className="mt-3" onClick={generate} loading={loading}>
                  <KeyRound /> {code ? "Code expired — generate a new one" : "Generate pairing code"}
                </Button>
              )}
              {code && countdown && countdown.seconds > 0 && <p className="mt-1.5 text-xs text-muted">Single use · expires in {countdown.label}</p>}
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-ink">3</span>
            <div>
              <p className="font-medium">Select the printer to share in the bridge</p>
              <p className="text-muted">It will appear here for you to register.</p>
            </div>
          </li>
        </ol>

        <div className="mt-6 flex items-center gap-3 rounded-2xl bg-canvas p-4 text-sm ring-1 ring-inset ring-line" aria-live="polite">
          {paired ? (
            <>
              <MonitorSmartphone className="size-5 text-success" aria-hidden />
              <span className="flex-1">
                <span className="font-medium text-ink">{paired.name}</span> is connected.
              </span>
              <Button size="sm" onClick={() => onOpenChange(false)}>
                Continue
              </Button>
            </>
          ) : (
            <>
              <LoaderCircle className={code ? "size-5 animate-spin text-accent" : "size-5 text-subtle"} aria-hidden />
              <span className="text-muted">{code ? "Waiting for the bridge to connect…" : "Generate a code to start pairing."}</span>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
