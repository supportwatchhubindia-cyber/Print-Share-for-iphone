import { api, isSecureRequest, json } from "@/server/http";
import { optionalUser } from "@/server/auth/guard";
import { clearSessionCookie, revokeSession } from "@/server/auth/session";
import { audit } from "@/server/audit";

export const POST = api(async (req) => {
  const auth = await optionalUser(req);
  if (auth) {
    await revokeSession(auth.session.id);
    await audit({ action: "auth.logout", actorType: "USER", actorId: auth.user.id, userId: auth.user.id, req });
  }
  const res = json({ ok: true });
  clearSessionCookie(res, isSecureRequest(req));
  return res;
});
