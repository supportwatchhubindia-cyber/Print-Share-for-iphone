"use client";

import useSWR, { type SWRConfiguration } from "swr";
import useSWRInfinite from "swr/infinite";
import { fetcher } from "@/lib/api-client";
import type {
  BridgeDTO,
  DocumentDetailDTO,
  DocumentDTO,
  MeDTO,
  Paginated,
  PrinterDTO,
  PrintJobDetailDTO,
  PrintJobDTO,
  SessionDTO,
} from "@/lib/types";

// Realtime events trigger revalidation; polling is only a slow safety net.
const live: SWRConfiguration = { refreshInterval: 60_000, revalidateOnFocus: true };

export const useMe = () => useSWR<MeDTO>("/api/auth/me", fetcher, live);
export const usePrinters = () => useSWR<{ printers: PrinterDTO[] }>("/api/printers", fetcher, live);
export const useBridges = () => useSWR<{ bridges: BridgeDTO[] }>("/api/bridges", fetcher, live);
export const useSessions = () => useSWR<{ sessions: SessionDTO[] }>("/api/auth/sessions", fetcher);

export function usePrinter(id: string | null) {
  return useSWR<{ printer: PrinterDTO; model: { displayName: string; printLanguage: string; notes: string[]; verification: string } }>(
    id ? `/api/printers/${id}` : null,
    fetcher,
    live,
  );
}

export function useDocuments(limit = 20) {
  return useSWR<Paginated<DocumentDTO>>(`/api/documents?limit=${limit}`, fetcher);
}

export function useDocument(id: string | null) {
  // Signed URLs live 15 minutes; refresh well before that.
  return useSWR<{ document: DocumentDetailDTO }>(id ? `/api/documents/${id}` : null, fetcher, { refreshInterval: 10 * 60_000 });
}

export function useRecentJobs(limit = 5) {
  return useSWR<Paginated<PrintJobDTO>>(`/api/print-jobs?limit=${limit}`, fetcher, live);
}

export function useJob(id: string | null) {
  return useSWR<{ job: PrintJobDetailDTO }>(id ? `/api/print-jobs/${id}` : null, fetcher, live);
}

export function useJobsInfinite(filters: { status?: string; printerId?: string; q?: string }) {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.printerId) qs.set("printerId", filters.printerId);
  if (filters.q) qs.set("q", filters.q);
  qs.set("limit", "20");
  return useSWRInfinite<Paginated<PrintJobDTO>>(
    (index, previous) => {
      if (previous && !previous.nextCursor) return null;
      const params = new URLSearchParams(qs);
      if (index > 0 && previous?.nextCursor) params.set("cursor", previous.nextCursor);
      return `/api/print-jobs?${params.toString()}`;
    },
    fetcher,
    live,
  );
}
