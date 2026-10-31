import { after } from "next/server";
import { runFastMaintenance, runSlowMaintenance } from "./maintenance";

const state = globalThis as unknown as { __printshareLastMaintenance?: number };
const EVERY_MS = 10 * 60_000;

/**
 * Serverless hosts have no long-lived timers (and Vercel Hobby crons run only daily), so
 * retention also runs opportunistically after user requests, at most every 10 minutes per instance.
 * Imported only by route handlers (uses next/server).
 */
export function scheduleMaintenance() {
  const now = Date.now();
  if (now - (state.__printshareLastMaintenance ?? 0) < EVERY_MS) return;
  state.__printshareLastMaintenance = now;
  try {
    after(async () => {
      try {
        await runFastMaintenance();
        await runSlowMaintenance();
      } catch (err) {
        console.error("[maintenance] background run failed", err);
      }
    });
  } catch {
    // Outside a request scope (scripts/tests): the server.ts timers or cron cover it.
  }
}
