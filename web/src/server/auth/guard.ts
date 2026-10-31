import type { NextRequest } from "next/server";
import { forbidden, unauthorized } from "../errors";
import { sessionTokenFromHeaders, validateSessionToken, type AuthenticatedSession } from "./session";

export async function requireUser(req: NextRequest): Promise<AuthenticatedSession> {
  const auth = await validateSessionToken(sessionTokenFromHeaders(req.headers));
  if (!auth) throw unauthorized();
  return auth;
}

export async function requireAdmin(req: NextRequest): Promise<AuthenticatedSession> {
  const auth = await requireUser(req);
  if (auth.user.role !== "ADMIN") throw forbidden("Administrator access required.");
  return auth;
}

export async function optionalUser(req: NextRequest): Promise<AuthenticatedSession | null> {
  return validateSessionToken(sessionTokenFromHeaders(req.headers));
}
