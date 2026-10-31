import { hash, verify } from "@node-rs/argon2";

// Argon2id (library default) with OWASP-recommended cost: 19 MiB, 2 iterations.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Verified against when the email is unknown so response timing does not reveal accounts.
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("printshare-timing-equaliser");
  await verifyPassword(await dummyHash, password);
}
