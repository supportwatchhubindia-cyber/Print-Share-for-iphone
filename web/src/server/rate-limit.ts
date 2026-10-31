import { ApiError } from "./errors";

type Bucket = { count: number; resetAt: number };

// Fixed-window counters held per process. For a multi-instance deployment put a
// shared limiter (e.g. at the reverse proxy) in front; these remain a safety net.
const store: Map<string, Bucket> =
  ((globalThis as Record<string, unknown>).__printshareRateLimit as Map<string, Bucket>) ?? new Map();
(globalThis as Record<string, unknown>).__printshareRateLimit = store;

let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of store) if (bucket.resetAt <= now) store.delete(key);
}

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  sweep(now);
  const bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  if (bucket.count > limit) return { allowed: false, remaining: 0, retryAfterSeconds };
  return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

export function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const result = checkRateLimit(key, limit, windowMs);
  if (!result.allowed) {
    throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again.", {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}

export function resetRateLimits() {
  store.clear();
}

export const LIMITS = {
  login: { limit: 10, windowMs: 60_000 },
  loginPerEmail: { limit: 8, windowMs: 15 * 60_000 },
  register: { limit: 5, windowMs: 60 * 60_000 },
  upload: { limit: 40, windowMs: 60_000 },
  createJob: { limit: 60, windowMs: 60_000 },
  pairing: { limit: 10, windowMs: 10 * 60_000 },
  bridgeRegister: { limit: 10, windowMs: 10 * 60_000 },
  bridgeApi: { limit: 240, windowMs: 60_000 },
  general: { limit: 300, windowMs: 60_000 },
} as const;
