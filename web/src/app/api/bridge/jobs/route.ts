import { api, json } from "@/server/http";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { requireBridge } from "@/server/bridge/service";
import { claimJobsForBridge, waitForBridgeWork } from "@/server/printing/jobs";

export const maxDuration = 30;

/**
 * GET /api/bridge/jobs?ready=<printerId>,<printerId>[&wait=<seconds>]
 * Returns in-flight jobs plus newly claimed jobs for printers the bridge reports as ready.
 * With wait>0 (used when the server has no WebSocket push, e.g. on Vercel) the request is held
 * open until there is work or the wait expires.
 */
export const GET = api(async (req) => {
  const bridge = await requireBridge(req);
  enforceRateLimit(`bridge:${bridge.id}`, LIMITS.bridgeApi.limit, LIMITS.bridgeApi.windowMs);
  const params = new URL(req.url).searchParams;
  const ready = (params.get("ready") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  const wait = Math.min(20, Math.max(0, Number(params.get("wait") ?? 0) || 0));
  if (wait > 0) await waitForBridgeWork(bridge, ready, wait, req.signal);
  return json({ jobs: await claimJobsForBridge(bridge, ready) });
});
