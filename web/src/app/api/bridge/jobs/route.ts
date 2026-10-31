import { api, json } from "@/server/http";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { requireBridge } from "@/server/bridge/service";
import { claimJobsForBridge } from "@/server/printing/jobs";

/**
 * GET /api/bridge/jobs?ready=<printerId>,<printerId>
 * Returns in-flight jobs plus newly claimed jobs for printers the bridge reports as ready.
 */
export const GET = api(async (req) => {
  const bridge = await requireBridge(req);
  enforceRateLimit(`bridge:${bridge.id}`, LIMITS.bridgeApi.limit, LIMITS.bridgeApi.windowMs);
  const ready = (new URL(req.url).searchParams.get("ready") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  return json({ jobs: await claimJobsForBridge(bridge, ready) });
});
