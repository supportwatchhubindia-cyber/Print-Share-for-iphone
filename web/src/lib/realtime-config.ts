/** "poll" on serverless deployments (set at build time in next.config.ts), else "websocket". */
export const REALTIME_TRANSPORT: "websocket" | "poll" = process.env.NEXT_PUBLIC_REALTIME_TRANSPORT === "poll" ? "poll" : "websocket";

const ACTIVE = new Set(["UPLOADED", "QUEUED", "PROCESSING", "PRINTING"]);

export const isActiveStatus = (status: string) => ACTIVE.has(status);

/**
 * SWR refresh interval. With WebSockets, events drive revalidation and polling is a slow
 * safety net; in polling mode, refresh quickly while something is in progress.
 */
export function refreshEvery(activeMs: number, idleMs: number) {
  return (busy: boolean) => (REALTIME_TRANSPORT === "poll" ? (busy ? activeMs : idleMs) : 60_000);
}
