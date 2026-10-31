import type { NextResponse } from "next/server";
import type { DeviceSession, User } from "@prisma/client";
import { prisma } from "../db";
import { randomToken, sha256Hex } from "../crypto";
import { describeUserAgent } from "@/lib/device";

export const SESSION_COOKIE = "ps_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 15 * 60 * 1000;

export type AuthenticatedSession = { session: DeviceSession; user: User };

export async function createSession(userId: string, meta: { userAgent?: string | null; ipAddress?: string | null }) {
  const token = randomToken(32);
  const session = await prisma.deviceSession.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
      deviceLabel: describeUserAgent(meta.userAgent),
      ipAddress: meta.ipAddress ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return { token, session };
}

/** Resolves a raw session token to an active session + user, with sliding expiry. */
export async function validateSessionToken(token: string | null | undefined): Promise<AuthenticatedSession | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const found = await prisma.deviceSession.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!found || found.revokedAt || found.expiresAt.getTime() <= Date.now()) return null;
  if (found.user.status !== "ACTIVE") return null;

  if (Date.now() - found.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.deviceSession.update({
      where: { id: found.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }
  const { user, ...session } = found;
  return { session, user };
}

export async function revokeSession(sessionId: string) {
  await prisma.deviceSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export function setSessionCookie(res: NextResponse, token: string, secure: boolean) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(res: NextResponse, secure: boolean) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
}

/** Extracts a session token from the cookie or an `Authorization: Bearer` header (native clients). */
export function sessionTokenFromHeaders(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    // Bridge credentials are "<bridgeId>.<secret>"; session tokens never contain a dot.
    if (!token.includes(".")) return token;
  }
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}
