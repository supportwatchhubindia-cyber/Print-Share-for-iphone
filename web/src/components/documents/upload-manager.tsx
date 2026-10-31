"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Camera, CircleCheck, CloudUpload, LoaderCircle, Printer, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Progress, Skeleton } from "../ui/misc";
import { ConfirmDialog } from "../ui/dialog";
import { EmptyState, ErrorState, Notice } from "../shared/states";
import { FileIcon } from "./file-icon";
import { useDocuments } from "@/hooks/use-api";
import { apiFetch, errorMessage, uploadDocument } from "@/lib/api-client";
import { ACCEPT_ATTRIBUTE, ACCEPTED_EXTENSIONS, extensionOf, isAcceptedExtension } from "@/lib/constants";
import { formatBytes, plural, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DocumentDTO } from "@/lib/types";

type Item = {
  key: string;
  file: File;
  status: "queued" | "uploading" | "processing" | "ready" | "error";
  progress: number;
  error?: string;
  document?: DocumentDTO;
  abort?: AbortController;
};

const CONCURRENCY = 3;
let seq = 0;

export function UploadManager({ maxUploadMb, officeAvailable }: { maxUploadMb: number; officeAvailable: boolean }) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [items, setItems] = React.useState<Item[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const cameraInput = React.useRef<HTMLInputElement>(null);

  const update = React.useCallback((key: string, patch: Partial<Item>) => {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }, []);

  const addFiles = (files: FileList | File[]) => {
    const next: Item[] = Array.from(files).map((file) => {
      const ext = extensionOf(file.name);
      const key = `f${++seq}`;
      if (!isAcceptedExtension(ext)) {
        return { key, file, status: "error", progress: 0, error: `.${ext || "?"} files aren't supported.` };
      }
      if (file.size > maxUploadMb * 1024 * 1024) {
        return { key, file, status: "error", progress: 0, error: `Larger than ${maxUploadMb} MB.` };
      }
      if (file.size === 0) return { key, file, status: "error", progress: 0, error: "The file is empty." };
      return { key, file, status: "queued", progress: 0 };
    });
    setItems((list) => [...next, ...list]);
  };

  // Upload scheduler: keep up to CONCURRENCY uploads running.
  React.useEffect(() => {
    const running = items.filter((i) => i.status === "uploading" || i.status === "processing").length;
    const waiting = items.filter((i) => i.status === "queued").slice(0, Math.max(0, CONCURRENCY - running));
    for (const item of waiting) {
      const abort = new AbortController();
      update(item.key, { status: "uploading", progress: 0, abort });
      uploadDocument(
        item.file,
        (fraction) => update(item.key, fraction >= 1 ? { progress: 1, status: "processing" } : { progress: fraction }),
        abort.signal,
      )
        .then(({ document }) => {
          update(item.key, { status: "ready", progress: 1, document, abort: undefined });
          void mutate((k) => typeof k === "string" && k.startsWith("/api/documents"));
        })
        .catch((err) => update(item.key, { status: "error", error: errorMessage(err), abort: undefined }));
    }
  }, [items, update, mutate]);

  const ready = items.filter((i) => i.status === "ready");
  const busy = items.some((i) => i.status === "uploading" || i.status === "processing" || i.status === "queued");

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "relative flex flex-col items-center rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors sm:py-14",
          dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface",
        )}
      >
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <CloudUpload className="size-7" aria-hidden />
        </div>
        <p className="text-lg font-semibold tracking-tight">
          <span className="hidden sm:inline">Drag & drop files here</span>
          <span className="sm:hidden">Choose files to print</span>
        </p>
        <p className="mt-1 text-sm text-muted">
          {ACCEPTED_EXTENSIONS.filter((e) => e !== "jpeg").map((e) => e.toUpperCase()).join(", ")} · up to {maxUploadMb} MB each
        </p>
        <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button size="lg" onClick={() => fileInput.current?.click()}>
            Choose files
          </Button>
          <Button size="lg" variant="secondary" className="sm:hidden" onClick={() => cameraInput.current?.click()}>
            <Camera /> Take a photo
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/jpeg,image/png"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {!officeAvailable && (
        <Notice tone="warning" title="Office files can't be converted on this server">
          Word, Excel and PowerPoint uploads need LibreOffice on the server. Export them to PDF on your phone first, or ask the administrator to install LibreOffice.
        </Notice>
      )}

      {items.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>This upload</CardTitle>
              <CardDescription aria-live="polite">
                {busy ? "Uploading and preparing for print…" : `${plural(ready.length, "file")} ready to print`}
              </CardDescription>
            </div>
            {ready.length === 1 && !busy && (
              <Button onClick={() => router.push(`/documents/${ready[0]!.document!.id}`)}>
                <Printer /> Print
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <li key={item.key} className="flex items-center gap-3 py-3">
                  <FileIcon ext={extensionOf(item.file.name)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.file.name}</p>
                    <p className={cn("text-xs", item.status === "error" ? "text-danger" : "text-muted")}>
                      {item.status === "error"
                        ? item.error
                        : item.status === "queued"
                          ? `${formatBytes(item.file.size)} · waiting`
                          : item.status === "uploading"
                            ? `${formatBytes(item.file.size)} · uploading ${Math.round(item.progress * 100)}%`
                            : item.status === "processing"
                              ? `${formatBytes(item.file.size)} · preparing for print…`
                              : `${formatBytes(item.file.size)} · ${plural(item.document?.pageCount ?? 0, "page")}`}
                    </p>
                    {(item.status === "uploading" || item.status === "processing") && (
                      <Progress className="mt-2 h-1.5" value={item.status === "processing" ? 100 : item.progress * 100} label={`Uploading ${item.file.name}`} />
                    )}
                  </div>
                  {item.status === "ready" && item.document && (
                    <Button asChild size="sm" variant="soft">
                      <Link href={`/documents/${item.document.id}`}>
                        <Printer /> Print
                      </Link>
                    </Button>
                  )}
                  {item.status === "processing" && <LoaderCircle className="size-5 animate-spin text-accent" aria-label="Processing" />}
                  {item.status === "uploading" && (
                    <Button size="icon-sm" variant="ghost" aria-label="Cancel upload" onClick={() => item.abort?.abort()}>
                      <X />
                    </Button>
                  )}
                  {item.status === "error" && isAcceptedExtension(extensionOf(item.file.name)) && item.file.size <= maxUploadMb * 1048576 && (
                    <Button size="icon-sm" variant="ghost" aria-label="Retry upload" onClick={() => update(item.key, { status: "queued", error: undefined })}>
                      <RotateCcw />
                    </Button>
                  )}
                  {(item.status === "error" || item.status === "ready") && (
                    <Button size="icon-sm" variant="ghost" aria-label="Remove from list" onClick={() => setItems((l) => l.filter((i) => i.key !== item.key))}>
                      <X />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <RecentDocuments />
    </div>
  );
}

function RecentDocuments() {
  const { data, error, mutate } = useDocuments(20);
  const [toDelete, setToDelete] = React.useState<DocumentDTO | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your documents</CardTitle>
        <CardDescription>Files are deleted automatically after they expire.</CardDescription>
      </CardHeader>
      <CardContent>
        {error && <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />}
        {!data && !error && [0, 1, 2].map((i) => <Skeleton key={i} className="mb-2 h-14" />)}
        {data?.items.length === 0 && <EmptyState icon={<CircleCheck />} title="No documents yet" description="Uploaded files appear here until they expire." />}
        <ul className="divide-y divide-line">
          {data?.items.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-3">
              <FileIcon ext={d.extension} />
              <Link href={`/documents/${d.id}`} className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium hover:text-accent">{d.name}</p>
                <p className="text-xs text-muted">
                  {d.pageCount != null ? plural(d.pageCount, "page") : "Processing"} · {formatBytes(d.sizeBytes)} · uploaded {timeAgo(d.createdAt)} · expires{" "}
                  {new Date(d.expiresAt).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
                </p>
              </Link>
              <Button asChild size="sm" variant="soft" className="hidden sm:inline-flex">
                <Link href={`/documents/${d.id}`}>
                  <Printer /> Print
                </Link>
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Delete ${d.name}`} onClick={() => setToDelete(d)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete document?"
        description={`“${toDelete?.name ?? ""}” and its print-ready copy will be permanently removed from the server.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={async () => {
          if (!toDelete) return;
          setDeleting(true);
          try {
            await apiFetch(`/api/documents/${toDelete.id}`, { method: "DELETE" });
            toast.success("Document deleted");
            await mutate();
            setToDelete(null);
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setDeleting(false);
          }
        }}
      />
    </Card>
  );
}
