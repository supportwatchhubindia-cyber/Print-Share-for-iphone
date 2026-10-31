"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Info, Minus, Plus, Printer, RectangleHorizontal, RectangleVertical, TriangleAlert, Usb } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field, FieldError, Input, Label } from "../ui/input";
import { Segmented } from "../ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { EmptyState, Notice } from "../shared/states";
import { ApiClientError, apiFetch, errorMessage } from "@/lib/api-client";
import { PAPER_SIZE_INFO, PRINTER_STATE_LABEL, PRINT_QUALITY_INFO, type PaperSize, type PrintQuality } from "@/lib/constants";
import { parsePageRange } from "@/lib/printing/page-range";
import { defaultSettings, validateSettings, type PrintSettings } from "@/lib/printing/settings";
import { plural } from "@/lib/format";
import type { DocumentDTO, PrinterDTO, PrintJobDTO } from "@/lib/types";

function StaticOption({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex h-10 items-center justify-between rounded-xl bg-canvas px-3.5 text-sm ring-1 ring-inset ring-line">
        <span className="font-medium text-ink">{value}</span>
        <span className="text-xs text-muted">{hint}</span>
      </div>
    </div>
  );
}

export function PrintSettingsPanel({
  document,
  printers,
  pagesRemaining,
  onPagesChange,
}: {
  document: DocumentDTO;
  printers: PrinterDTO[];
  pagesRemaining: number | null;
  onPagesChange?: (pages: number[] | null) => void;
}) {
  const router = useRouter();
  const pageCount = document.pageCount ?? 1;
  const initial = printers.find((p) => p.available) ?? printers[0] ?? null;
  const [printerId, setPrinterId] = React.useState<string | null>(initial?.id ?? null);
  const printer = printers.find((p) => p.id === printerId) ?? null;
  const caps = printer?.capabilities;
  const [settings, setSettings] = React.useState<PrintSettings | null>(caps ? defaultSettings(caps) : null);
  const [pageMode, setPageMode] = React.useState<"all" | "custom">("all");
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);

  // Switching printers resets options to what the new printer supports (keeps copies + pages).
  React.useEffect(() => {
    if (!caps) return;
    setSettings((s) => ({ ...defaultSettings(caps), copies: Math.min(s?.copies ?? 1, caps.maxCopies), pageRange: s?.pageRange ?? null }));
    setFields({});
  }, [printerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const range = parsePageRange(pageMode === "all" ? null : settings?.pageRange, pageCount);
  const pages = range.ok ? range.pages.length : 0;
  const total = pages * (settings?.copies ?? 1);
  const overQuota = pagesRemaining != null && total > pagesRemaining;

  React.useEffect(() => {
    onPagesChange?.(pageMode === "custom" && range.ok ? range.pages : null);
  }, [pageMode, settings?.pageRange]); // eslint-disable-line react-hooks/exhaustive-deps

  if (printers.length === 0) {
    return (
      <EmptyState
        icon={<Usb />}
        title="Connect a printer first"
        description="Install PrintShare Bridge on the Windows PC your printer is plugged into, then register the printer."
        action={
          <Button asChild>
            <Link href="/printers">Set up a printer</Link>
          </Button>
        }
      />
    );
  }
  if (!printer || !caps || !settings) return null;

  const set = <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) => {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setFields((f) => ({ ...f, [key]: "" }));
  };

  async function submit() {
    if (!printer || !caps || !settings) return;
    const payload: PrintSettings = { ...settings, pageRange: pageMode === "all" ? null : settings.pageRange };
    const check = validateSettings(payload, caps, pageCount);
    if (!check.ok) {
      setFields(check.fields);
      return;
    }
    setSubmitting(true);
    try {
      const { job } = await apiFetch<{ job: PrintJobDTO }>("/api/print-jobs", {
        method: "POST",
        json: { documentId: document.id, printerId: printer.id, settings: payload },
      });
      toast.success("Sent to printer", { description: `${job.documentName} is queued on ${printer.name}.` });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) setFields(err.fields);
      toast.error(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-5 p-5 sm:p-6">
      <Field label="Printer" error={fields.printerId}>
        <Select value={printer.id} onValueChange={setPrinterId}>
          <SelectTrigger aria-label="Printer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {printers.map((p) => (
              <SelectItem key={p.id} value={p.id} description={`${p.modelName} · ${p.available ? "Ready" : PRINTER_STATE_LABEL[p.state]}`}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {!printer.available && (
        <Notice tone="warning" icon={<TriangleAlert />} title={`${printer.name} is ${PRINTER_STATE_LABEL[printer.state].toLowerCase()}`}>
          {printer.stateMessage ?? "The job will wait in the queue and print as soon as the printer is ready."}
        </Notice>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="copies">Copies</Label>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" aria-label="Fewer copies" disabled={settings.copies <= 1} onClick={() => set("copies", settings.copies - 1)}>
            <Minus />
          </Button>
          <Input
            id="copies"
            inputMode="numeric"
            className="w-20 text-center tabular-nums"
            value={settings.copies}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, ""));
              set("copies", Math.max(1, Math.min(caps.maxCopies, n || 1)));
            }}
            invalid={!!fields.copies}
          />
          <Button variant="secondary" size="icon" aria-label="More copies" disabled={settings.copies >= caps.maxCopies} onClick={() => set("copies", settings.copies + 1)}>
            <Plus />
          </Button>
        </div>
        <FieldError>{fields.copies}</FieldError>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Pages</Label>
        <Segmented
          name="Pages"
          value={pageMode}
          onChange={(v) => {
            setPageMode(v);
            setFields((f) => ({ ...f, pageRange: "" }));
          }}
          options={[
            { value: "all", label: `All ${pageCount}` },
            { value: "custom", label: "Custom range" },
          ]}
        />
        {pageMode === "custom" && (
          <Input
            aria-label="Page range"
            placeholder={`e.g. 1-${Math.min(3, pageCount)}${pageCount > 4 ? ", 5" : ""}`}
            value={settings.pageRange ?? ""}
            onChange={(e) => set("pageRange", e.target.value)}
            invalid={!!fields.pageRange || (!!settings.pageRange && !range.ok)}
          />
        )}
        <FieldError>{fields.pageRange || (pageMode === "custom" && settings.pageRange && !range.ok ? range.error : undefined)}</FieldError>
      </div>

      <Field label="Paper size" error={fields.paperSize}>
        <Select value={settings.paperSize} onValueChange={(v) => set("paperSize", v as PaperSize)}>
          <SelectTrigger aria-label="Paper size" invalid={!!fields.paperSize}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {caps.paperSizes.map((p) => (
              <SelectItem key={p} value={p}>
                {PAPER_SIZE_INFO[p].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="flex flex-col gap-1.5">
        <Label>Orientation</Label>
        <Segmented
          name="Orientation"
          value={settings.orientation}
          onChange={(v) => set("orientation", v)}
          options={caps.orientations.map((o) => ({
            value: o,
            label: o === "PORTRAIT" ? "Portrait" : "Landscape",
            icon: o === "PORTRAIT" ? <RectangleVertical /> : <RectangleHorizontal />,
          }))}
        />
      </div>

      {caps.color ? (
        <div className="flex flex-col gap-1.5">
          <Label>Colour</Label>
          <Segmented name="Colour" value={settings.colorMode} onChange={(v) => set("colorMode", v)} options={[{ value: "MONOCHROME", label: "Black & white" }, { value: "COLOR", label: "Colour" }]} />
        </div>
      ) : (
        <StaticOption label="Colour" value="Black & white" hint="Monochrome printer" />
      )}

      {caps.duplex ? (
        <div className="flex flex-col gap-1.5">
          <Label>Sides</Label>
          <Segmented
            name="Sides"
            value={settings.duplex}
            onChange={(v) => set("duplex", v)}
            options={[
              { value: "SIMPLEX", label: "One side" },
              { value: "LONG_EDGE", label: "Long edge" },
              { value: "SHORT_EDGE", label: "Short edge" },
            ]}
          />
        </div>
      ) : (
        <StaticOption label="Sides" value="Single-sided" hint="No automatic duplex" />
      )}

      {caps.qualities.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <Label>Quality</Label>
          <Segmented name="Quality" value={settings.quality} onChange={(v) => set("quality", v as PrintQuality)} options={caps.qualities.map((q) => ({ value: q, label: PRINT_QUALITY_INFO[q].label }))} />
          <p className="text-xs text-muted">{PRINT_QUALITY_INFO[settings.quality].hint}</p>
        </div>
      ) : (
        <StaticOption label="Quality" value={PRINT_QUALITY_INFO[settings.quality].label} hint={`${PRINT_QUALITY_INFO[settings.quality].dpi} dpi`} />
      )}

      <div className="flex flex-col gap-1.5">
        <Label>Scaling</Label>
        <Segmented
          name="Scaling"
          value={settings.scaleMode}
          onChange={(v) => set("scaleMode", v)}
          options={caps.scaleModes.map((s) => ({ value: s, label: s === "FIT" ? "Fit to page" : "Actual size" }))}
        />
      </div>

      <div className="rounded-2xl bg-canvas p-4 ring-1 ring-inset ring-line">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted">
            {plural(pages, "page")} × {plural(settings.copies, "copy", "copies")}
          </span>
          <span className="font-semibold tabular-nums">{plural(total, "sheet")}</span>
        </div>
        {pagesRemaining != null && (
          <p className={overQuota ? "mt-1 text-xs text-danger" : "mt-1 text-xs text-muted"}>
            {overQuota ? `Your plan has ${pagesRemaining} pages left this month.` : `${pagesRemaining.toLocaleString()} pages left this month`}
          </p>
        )}
      </div>

      <Button size="lg" className="w-full" onClick={submit} loading={submitting} disabled={!range.ok || overQuota}>
        <Printer /> Print {total > 0 ? plural(total, "page") : ""}
      </Button>
      {printer.modelKey === "HP_LJ_M1005" && (
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Printed through the HP driver on {printer.bridge?.name ?? "your Windows PC"}. Status turns “Completed” only after Windows confirms the job reached the printer.
        </p>
      )}
    </Card>
  );
}
