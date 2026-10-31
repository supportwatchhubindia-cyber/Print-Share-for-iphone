import { z } from "zod";
import { prisma } from "@/server/db";
import { api, clientIp, conflict, isSecureRequest, json, readJson } from "@/server/http";
import { enforceRateLimit, LIMITS } from "@/server/rate-limit";
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN } from "@/server/auth/password";
import { createSession, setSessionCookie } from "@/server/auth/session";
import { ensureSubscription } from "@/server/billing/usage";
import { audit } from "@/server/audit";
import { toUserDTO } from "@/server/dto";

const schema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX),
});

export const POST = api(async (req) => {
  const ip = clientIp(req);
  enforceRateLimit(`register:${ip}`, LIMITS.register.limit, LIMITS.register.windowMs);
  const input = await readJson(req, schema);

  if (await prisma.user.findUnique({ where: { email: input.email } })) {
    throw conflict("An account with this email already exists. Sign in instead.", "EMAIL_TAKEN");
  }
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, passwordHash: await hashPassword(input.password), lastLoginAt: new Date() },
  });
  await ensureSubscription(user.id);
  const { token } = await createSession(user.id, { userAgent: req.headers.get("user-agent"), ipAddress: ip });
  await audit({ action: "auth.register", actorType: "USER", actorId: user.id, userId: user.id, req });

  const res = json({ user: toUserDTO(user) }, 201);
  setSessionCookie(res, token, isSecureRequest(req));
  return res;
});
