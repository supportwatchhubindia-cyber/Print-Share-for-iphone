import { z } from "zod";

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

// On Vercel the production domain is known without configuration.
const defaultAppUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.string().url().default(defaultAppUrl),
  VERCEL: bool.default(false),
  /** "local" disk (self-hosted) or private "vercel-blob". Defaults to blob when a Blob store is connected. */
  STORAGE_DRIVER: z.enum(["local", "vercel-blob"]).optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional().default(""),
  BLOB_STORE_ID: z.string().optional().default(""),
  /** "websocket" needs the custom server (server.ts); "poll" works on serverless hosts. */
  REALTIME_TRANSPORT: z.enum(["websocket", "poll"]).optional(),
  /** Gotenberg (https://gotenberg.dev) URL for Office -> PDF where LibreOffice can't run (e.g. Vercel). */
  GOTENBERG_URL: z.string().url().optional().or(z.literal("")).default(""),
  /** Optional "user:password" for Gotenberg basic auth. */
  GOTENBERG_AUTH: z.string().optional().default(""),
  /** Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". */
  CRON_SECRET: z.string().optional().default(""),
  /** Where the dashboard links "Download PrintShare Bridge" (e.g. a release asset). */
  BRIDGE_DOWNLOAD_URL: z.string().url().optional().or(z.literal("")).default(""),
  SIGNING_SECRET: z.string().min(32, "SIGNING_SECRET must be at least 32 characters"),
  TRUST_PROXY: bool.default(false),
  STORAGE_DIR: z.string().default("./storage"),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(200).default(25),
  DOCUMENT_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24),
  LIBREOFFICE_PATH: z.string().optional().default(""),
  LIBREOFFICE_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(90_000),
  CLAMAV_HOST: z.string().optional().default(""),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  MALWARE_SCAN_REQUIRED: bool.default(false),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated environment. Throws a readable error on misconfiguration. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export type StorageDriverName = "local" | "vercel-blob";

export function storageDriverName(): StorageDriverName {
  const e = env();
  if (e.STORAGE_DRIVER) return e.STORAGE_DRIVER;
  return e.BLOB_READ_WRITE_TOKEN || e.BLOB_STORE_ID ? "vercel-blob" : "local";
}

/** WebSockets need the long-lived custom server; serverless deployments fall back to polling. */
export function realtimeTransport(): "websocket" | "poll" {
  const e = env();
  return e.REALTIME_TRANSPORT ?? (e.VERCEL ? "poll" : "websocket");
}

/** Vercel caps function request bodies at 4.5 MB, so browsers upload straight to Blob there. */
export function uploadMode(): "direct" | "blob" {
  return env().VERCEL && storageDriverName() === "vercel-blob" ? "blob" : "direct";
}

/** For tests that mutate process.env between cases. */
export function resetEnvCache() {
  cached = null;
}
