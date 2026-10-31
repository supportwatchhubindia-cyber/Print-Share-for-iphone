import { api, json } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { ensureSubscription, getUsageSummary } from "@/server/billing/usage";
import { toSubscriptionDTO, toUserDTO } from "@/server/dto";
import type { MeDTO } from "@/lib/types";

export const GET = api(async (req) => {
  const { user } = await requireUser(req);
  const [subscription, usage] = await Promise.all([ensureSubscription(user.id), getUsageSummary(user.id)]);
  const body: MeDTO = { user: toUserDTO(user), subscription: toSubscriptionDTO(subscription), usage };
  return json(body);
});
