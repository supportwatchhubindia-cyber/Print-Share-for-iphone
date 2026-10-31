"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, FileExclamationPoint } from "lucide-react";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/misc";
import { Badge } from "../ui/badge";
import { openPdf, safeScale, type PdfDocumentProxy } from "@/lib/pdfjs";
import { cn } from "@/lib/utils";

/** Page-by-page PDF preview rendered with PDF.js; marks which pages are selected for printing. */
export function PdfPreview({ url, selectedPages, className }: { url: string; selectedPages?: number[] | null; className?: string }) {
  const [pdf, setPdf] = React.useState<PdfDocumentProxy | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const [rendering, setRendering] = React.useState(true);
  const [width, setWidth] = React.useState(0);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  // The signed URL rotates every few minutes; only reload when the document path changes.
  const docPath = React.useMemo(() => url.split("?")[0], [url]);
  const urlRef = React.useRef(url);
  urlRef.current = url;

  React.useEffect(() => {
    let cancelled = false;
    let loaded: PdfDocumentProxy | null = null;
    setPdf(null);
    setError(null);
    setPage(1);
    openPdf(urlRef.current)
      .then((doc) => {
        if (cancelled) return void doc.destroy();
        loaded = doc;
        setPdf(doc);
      })
      .catch(() => !cancelled && setError("Preview unavailable. You can still print this document."));
    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [docPath]);

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    if (!pdf || !width || !canvasRef.current) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    setRendering(true);
    (async () => {
      const p = await pdf.getPage(page);
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssScale = width / base.width;
      const scale = safeScale(base.width, base.height, cssScale * dpr);
      const viewport = p.getViewport({ scale });
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${Math.round(base.height * cssScale)}px`;
      task = p.render({ canvasContext: ctx, viewport });
      await task.promise;
      if (!cancelled) setRendering(false);
    })().catch((err: { name?: string }) => {
      if (!cancelled && err?.name !== "RenderingCancelledException") setError("Could not render this page.");
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, width]);

  const total = pdf?.numPages ?? 0;
  const included = !selectedPages || selectedPages.includes(page);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div ref={boxRef} className="relative overflow-hidden rounded-2xl border border-line bg-canvas p-3 sm:p-4">
        {error ? (
          <div className="flex aspect-[1/1.414] flex-col items-center justify-center gap-2 text-center text-sm text-muted">
            <FileExclamationPoint className="size-8 text-subtle" aria-hidden />
            {error}
          </div>
        ) : (
          <div className="relative">
            {(!pdf || rendering) && <Skeleton className="absolute inset-0 z-10 rounded-lg bg-line/60" />}
            <canvas
              ref={canvasRef}
              className={cn("mx-auto block max-w-full rounded-md bg-white shadow-card transition-opacity", !included && "opacity-40")}
              style={{ aspectRatio: pdf ? undefined : "1 / 1.414", width: "100%" }}
              aria-label={`Preview of page ${page}`}
              role="img"
            />
            {selectedPages && pdf && (
              <Badge tone={included ? "accent" : "neutral"} className="absolute left-2 top-2 shadow-soft">
                {included ? "Will print" : "Skipped"}
              </Badge>
            )}
          </div>
        )}
      </div>
      {total > 0 && (
        <div className="flex items-center justify-between gap-2">
          <Button variant="secondary" size="icon" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <span className="text-sm tabular-nums text-muted" aria-live="polite">
            Page {page} of {total}
          </span>
          <Button variant="secondary" size="icon" onClick={() => setPage((p) => Math.min(total, p + 1))} disabled={page >= total} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
