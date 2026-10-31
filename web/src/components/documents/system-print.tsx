"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Info, LoaderCircle, Printer } from "lucide-react";
import { Button } from "../ui/button";
import { ErrorState } from "../shared/states";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { openPdf, safeScale } from "@/lib/pdfjs";
import type { DocumentDetailDTO } from "@/lib/types";

const PRINT_DPI = 150;

/**
 * Renders the print-ready PDF to page images and opens the device's own print dialog.
 * On iPhone/iPad, window.print() shows the native AirPrint sheet (AirPrint printers on the
 * same network only). Desktop browsers show their normal print dialog.
 */
export function SystemPrint({ id }: { id: string }) {
  const [doc, setDoc] = React.useState<DocumentDetailDTO | null>(null);
  const [pages, setPages] = React.useState<string[]>([]);
  const [total, setTotal] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const urls = React.useRef<string[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const { document } = await apiFetch<{ document: DocumentDetailDTO }>(`/api/documents/${id}`);
      if (cancelled) return;
      setDoc(document);
      if (!document.pdfUrl) throw new Error("This document is not ready to print.");
      const pdf = await openPdf(document.pdfUrl);
      setTotal(pdf.numPages);
      for (let n = 1; n <= pdf.numPages && !cancelled; n++) {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: safeScale(base.width, base.height, PRINT_DPI / 72, 8_000_000) });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
        canvas.width = canvas.height = 0; // release canvas memory early (iOS)
        if (!blob || cancelled) continue;
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        setPages((p) => [...p, url]);
      }
      void pdf.destroy();
    })().catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    };
  }, [id]);

  const ready = total > 0 && pages.length === total;

  return (
    <div className="min-h-dvh bg-canvas print:bg-white">
      <div className="no-print pt-safe sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back">
            <Link href={`/documents/${id}`}>
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{doc?.name ?? "Preparing…"}</p>
            <p className="text-xs text-muted">{ready ? `${total} page${total === 1 ? "" : "s"} ready` : total ? `Rendering ${pages.length} of ${total}…` : "Loading…"}</p>
          </div>
          <Button onClick={() => window.print()} disabled={!ready}>
            {ready ? <Printer /> : <LoaderCircle className="animate-spin" />} Print
          </Button>
        </div>
      </div>

      <div className="no-print mx-auto max-w-3xl px-4 pt-4">
        <div className="flex gap-2.5 rounded-2xl border border-accent/15 bg-accent-soft p-3.5 text-[13px] text-ink-soft">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <p>
            This uses your device&apos;s own print dialog. On iPhone that&apos;s AirPrint, which lists only AirPrint printers on the same Wi-Fi. A USB printer such as the HP
            LaserJet M1005 is not an AirPrint printer — to print on it, go back and send the job through your PrintShare bridge.
          </p>
        </div>
        {error && <ErrorState message={error} className="mt-4" />}
      </div>

      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 print:block print:max-w-none print:p-0">
        {pages.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt={`Page ${i + 1}`} className="w-full rounded-lg bg-white shadow-card print:break-after-page print:rounded-none print:shadow-none" />
        ))}
      </div>
      <style>{`@media print { @page { margin: 0; } html, body { background: #fff !important; } }`}</style>
    </div>
  );
}
