import { api, clientIp, json, readJson } from "@/server/http";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { registerBridge, registerBridgeSchema } from "@/server/bridge/service";

/** Called by PrintShare Bridge with a one-time pairing code. Returns credentials once. */
export const POST = api(async (req) => {
  enforceRateLimit(`bridge-register:${clientIp(req)}`, LIMITS.bridgeRegister.limit, LIMITS.bridgeRegister.windowMs);
  const input = await readJson(req, registerBridgeSchema);
  return json(await registerBridge(input, req), 201);
});
