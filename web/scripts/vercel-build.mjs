// Vercel build: generate the Prisma client, apply migrations for production deployments, build Next.js.
//
// Migrations run with DIRECT_URL (a non-pooled connection) when it is set, because Prisma Migrate
// can't run through a transaction-mode pooler (PgBouncer, Neon "-pooler", Supabase :6543).
// Preview deployments skip migrations unless MIGRATE_ON_BUILD=true, so a preview can't change
// the production schema by accident.
import { execSync } from "node:child_process";

const run = (cmd, extraEnv = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...extraEnv } });

run("npx prisma generate");

const migrate = process.env.VERCEL_ENV === "production" || process.env.MIGRATE_ON_BUILD === "true";
if (migrate) {
  const direct = process.env.DIRECT_URL;
  console.log(`[vercel-build] applying migrations${direct ? " via DIRECT_URL" : ""}`);
  run("npx prisma migrate deploy", direct ? { DATABASE_URL: direct } : {});
} else {
  console.log(`[vercel-build] skipping migrations for VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"} (set MIGRATE_ON_BUILD=true to run them)`);
}

run("npx next build");
