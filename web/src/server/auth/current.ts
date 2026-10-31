import { cookies } from "next/headers";
import { SESSION_COOKIE, validateSessionToken } from "./session";

/** For server components / layouts (uses the request cookie store). */
export async function getCurrentUser() {
  const store = await cookies();
  const auth = await validateSessionToken(store.get(SESSION_COOKIE)?.value);
  return auth?.user ?? null;
}
