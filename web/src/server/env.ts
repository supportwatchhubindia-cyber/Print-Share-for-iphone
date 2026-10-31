import { z } from "zod";

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.string().url().default("http://localhost:3000"),
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

/** For tests that mutate process.env between cases. */
export function resetEnvCache() {
  cached = null;
}
