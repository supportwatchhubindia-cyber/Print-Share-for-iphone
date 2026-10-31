"use client";

type PdfJs = typeof import("pdfjs-dist");
let loader: Promise<PdfJs> | null = null;

/**
 * Loads PDF.js (legacy build for older iOS Safari) from /public as a native ES module.
 * Kept out of the bundle on purpose: avoids bundler worker quirks and keeps CSP at 'self'.
 */
export function loadPdfJs(): Promise<PdfJs> {
  loader ??= (async () => {
    const src = "/pdfjs/pdf.min.mjs";
    const mod = (await import(/* webpackIgnore: true */ src)) as PdfJs;
    mod.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return mod;
  })().catch((err) => {
    loader = null;
    throw err;
  });
  return loader;
}

export type PdfDocumentProxy = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;

export async function openPdf(url: string): Promise<PdfDocumentProxy> {
  const pdfjs = await loadPdfJs();
  // URLs are self-authorising (signed route or presigned Blob URL); no cookies, so cross-origin CORS stays simple.
  return pdfjs.getDocument({ url, isEvalSupported: false, withCredentials: false }).promise;
}

/** iOS Safari kills pages whose canvases exceed its memory budget; stay under ~16.7 MP per canvas. */
export function safeScale(width: number, height: number, desired: number, maxPixels = 16_000_000): number {
  const pixels = width * height * desired * desired;
  return pixels > maxPixels ? Math.sqrt(maxPixels / (width * height)) : desired;
}
