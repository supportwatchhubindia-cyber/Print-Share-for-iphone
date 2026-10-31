import { z } from "zod";
import { prisma } from "@/server/db";
import { ApiError, api, clientIp, isSecureRequest, json, readJson } from "@/server/http";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { burnPasswordCheck, verifyPassword } from "@/server/auth/password";
import { createSession, setSessionCookie } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { toUserDTO } from "@/server/dto";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  password: z.string().min(1, "Enter your password").max(200),
  /** Native clients (Android companion) receive the token in the body instead of a cookie. */
  tokenMode: z.boolean().optional(),
});

export const POST = api(async (req) => {
  const ip = clientIp(req);
  enforceRateLimit(`login:${ip}`, LIMITS.login.limit, LIMITS.login.windowMs);
  const input = await readJson(req, schema);
  enforceRateLimit(`login-email:${input.email}`, LIMITS.loginPerEmail.limit, LIMITS.loginPerEmail.windowMs);

  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const valid = user ? await verifyPassword(user.passwordHash, input.password) : (await burnPasswordCheck(input.password), false);
  if (!user || !valid) {
    await audit({ action: "auth.login_failed", actorType: "SYSTEM", userId: user?.id ?? null, req, metadata: { email: input.email } });
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }
  if (user.status !== "ACTIVE") throw new ApiError(403, "ACCOUNT_SUSPENDED", "This account has been suspended. Contact support.");

  const { token } = await createSession(user.id, { userAgent: req.headers.get("user-agent"), ipAddress: ip });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ action: "auth.login", actorType: "USER", actorId: user.id, userId: user.id, req });

  const res = json({ user: toUserDTO(user), ...(input.tokenMode ? { token } : {}) });
  if (!input.tokenMode) setSessionCookie(res, token, isSecureRequest(req));
  return res;
});
