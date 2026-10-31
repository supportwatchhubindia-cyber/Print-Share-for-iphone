"use client";

import * as React from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import type { ClientRealtimeEvent } from "@/lib/types";

export type RealtimeStatus = "connecting" | "live" | "offline";
const RealtimeContext = React.createContext<RealtimeStatus>("connecting");
export const useRealtimeStatus = () => React.useContext(RealtimeContext);

const isKey = (prefixes: string[]) => (key: unknown) => typeof key === "string" && prefixes.some((p) => key.startsWith(p));
const isInfiniteJobs = (key: unknown) => typeof key === "string" && key.startsWith("$inf$/api/print-jobs");

/**
 * One WebSocket per tab. Events only say *what* changed; SWR refetches the details,
 * so a missed event is healed by the next revalidation. Reconnects with backoff and
 * refetches everything after a reconnect (e.g. iPhone waking from sleep).
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { mutate } = useSWRConfig();
  const [status, setStatus] = React.useState<RealtimeStatus>("connecting");
  const announced = React.useRef(new Set<string>());

  React.useEffect(() => {
    let ws: WebSocket | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const handle = (evt: ClientRealtimeEvent) => {
      switch (evt.type) {
        case "job.updated": {
          void mutate((k) => isKey(["/api/print-jobs", "/api/auth/me", "/api/printers"])(k) || isInfiniteJobs(k));
          const key = `${evt.jobId}:${evt.status}`;
          if (!announced.current.has(key)) {
            announced.current.add(key);
            if (evt.status === "COMPLETED") toast.success("Print job completed", { description: "Windows confirmed the job reached the printer." });
            if (evt.status === "FAILED") toast.error("Print job failed", { description: "Open the job for details and retry." });
          }
          break;
        }
        case "printer.updated":
        case "bridge.updated":
          void mutate(isKey(["/api/printers", "/api/bridges"]));
          break;
        case "document.updated":
          void mutate(isKey(["/api/documents"]));
          break;
      }
    };

    const connect = () => {
      if (stopped) return;
      clearTimeout(timer);
      setStatus("connecting");
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${proto}://${window.location.host}/ws`);
      ws = socket;
      socket.onopen = () => {
        attempt = 0;
        setStatus("live");
        void mutate(() => true);
      };
      socket.onmessage = (e) => {
        try {
          const evt = JSON.parse(String(e.data)) as ClientRealtimeEvent | { type: "hello" };
          if (evt.type !== "hello") handle(evt);
        } catch {
          /* ignore malformed frames */
        }
      };
      socket.onclose = () => {
        if (ws !== socket) return;
        setStatus("offline");
        if (stopped) return;
        const delay = Math.min(30_000, 1_000 * 2 ** attempt++) + Math.random() * 500;
        timer = setTimeout(connect, delay);
      };
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && (!ws || ws.readyState === WebSocket.CLOSED)) {
        attempt = 0;
        connect();
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      ws?.close();
    };
  }, [mutate]);

  return <RealtimeContext.Provider value={status}>{children}</RealtimeContext.Provider>;
}
