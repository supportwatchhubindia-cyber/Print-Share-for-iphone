import { api, json, readJson } from "@/server/http";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { requireBridge } from "@/server/bridge/service";
import { applyBridgeStatus, bridgeStatusSchema } from "@/server/printing/jobs";

export const POST = api<{ id: string }>(async (req, { params }) => {
  const bridge = await requireBridge(req);
  enforceRateLimit(`bridge:${bridge.id}`, LIMITS.bridgeApi.limit, LIMITS.bridgeApi.windowMs);
  const input = await readJson(req, bridgeStatusSchema);
  const result = await applyBridgeStatus(bridge, params.id, input);
  return json({ status: result.status, cancelRequested: result.cancelRequested });
});
