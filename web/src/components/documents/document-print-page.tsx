"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Download, FileExclamationPoint, LoaderCircle, Smartphone } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Skeleton } from "../ui/misc";
import { EmptyState, ErrorState } from "../shared/states";
import { FileIcon } from "./file-icon";
import { PdfPreview } from "./pdf-preview";
import { PrintSettingsPanel } from "../printing/print-settings";
import { useDocument, useMe, usePrinters } from "@/hooks/use-api";
import { ApiClientError, errorMessage } from "@/lib/api-client";
import { formatBytes, plural, timeAgo } from "@/lib/format";

export function DocumentPrintPage({ id }: { id: string }) {
  const doc = useDocument(id);
  const printers = usePrinters();
  const me = useMe();
  const [selectedPages, setSelectedPages] = React.useState<number[] | null>(null);
  const d = doc.data?.document;

  if (doc.error) {
    const missing = doc.error instanceof ApiClientError && doc.error.status === 404;
    return missing ? (
      <EmptyState
        icon={<FileExclamationPoint />}
        title="Document not found"
        description="It may have expired or been deleted. Documents are removed automatically after their retention period."
        action={
          <Button asChild>
            <Link href="/upload">Upload again</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState message={errorMessage(doc.error)} onRetry={() => doc.mutate()} />
    );
  }

  const remaining = me.data ? Math.max(0, me.data.usage.pageLimit - me.data.usage.pagesUsed) : null;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/upload">
          <ArrowLeft /> Documents
        </Link>
      </Button>

      <div className="flex items-start gap-3">
        {d ? <FileIcon ext={d.extension} className="size-12" /> : <Skeleton className="size-12" />}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{d?.name ?? <span className="inline-block h-7 w-56 animate-pulse-soft rounded-lg bg-canvas" />}</h1>
          {d && (
            <p className="text-sm text-muted">
              {d.pageCount != null ? plural(d.pageCount, "page") : "—"} · {formatBytes(d.sizeBytes)}
              {d.extension !== "pdf" && d.pdfSizeBytes ? ` · converted to PDF (${formatBytes(d.pdfSizeBytes)})` : ""} · uploaded {timeAgo(d.createdAt)}
            </p>
          )}
        </div>
      </div>

      {d && d.status !== "READY" ? (
        <EmptyState
          icon={d.status === "PROCESSING" ? <LoaderCircle className="animate-spin" /> : <FileExclamationPoint />}
          title={d.status === "PROCESSING" ? "Preparing document…" : d.status === "EXPIRED" ? "This document has expired" : "This document can't be printed"}
          description={d.errorMessage ?? (d.status === "EXPIRED" ? "Upload it again to print." : undefined)}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-3">
            {d?.pdfUrl ? <PdfPreview url={d.pdfUrl} selectedPages={selectedPages} /> : <Skeleton className="aspect-[1/1.414] w-full" />}
            {d?.pdfUrl && (
              <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                <div className="flex-1 text-sm">
                  <p className="font-medium">Print on this device instead</p>
                  <p className="text-muted">Uses your phone or computer&apos;s own print dialog (AirPrint on iPhone, same Wi-Fi only).</p>
                </div>
                <div className="flex gap-2">
                  <Button asChild variant="secondary" size="sm">
                    <a href={`/airprint/${id}`} target="_blank" rel="noopener">
                      <Smartphone /> System print
                    </a>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <a href={d.pdfUrl} target="_blank" rel="noopener">
                      <Download /> PDF
                    </a>
                  </Button>
                </div>
              </Card>
            )}
          </div>
          <div className="lg:sticky lg:top-6 lg:self-start">
            {!d || !printers.data ? (
              <Skeleton className="h-[640px]" />
            ) : printers.error ? (
              <ErrorState message={errorMessage(printers.error)} onRetry={() => printers.mutate()} />
            ) : (
              <PrintSettingsPanel document={d} printers={printers.data.printers} pagesRemaining={remaining} onPagesChange={setSelectedPages} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
