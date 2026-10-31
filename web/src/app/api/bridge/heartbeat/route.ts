import { api, json, readJson } from "@/server/http";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { heartbeatSchema, processHeartbeat, requireBridge } from "@/server/bridge/service";

export const POST = api(async (req) => {
  const bridge = await requireBridge(req);
  enforceRateLimit(`bridge:${bridge.id}`, LIMITS.bridgeApi.limit, LIMITS.bridgeApi.windowMs);
  const input = await readJson(req, heartbeatSchema);
  return json(await processHeartbeat(bridge, input, req));
});
