import { api, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { createPairingCode } from "@/server/bridge/service";

export const POST = api(async (req) => {
  const { user } = await requireUser(req);
  enforceRateLimit(`pairing:${user.id}`, LIMITS.pairing.limit, LIMITS.pairing.windowMs);
  const { code, expiresAt } = await createPairingCode(user.id, req);
  return json({ code, expiresAt: expiresAt.toISOString() }, 201);
});
