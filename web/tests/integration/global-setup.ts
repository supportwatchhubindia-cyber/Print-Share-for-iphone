import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://printshare@localhost:54329/printshare_test?schema=public";

/** Applies pending migrations (non-destructive). Tables are truncated per test file. */
export default function setup() {
  if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname)) {
    throw new Error(`Refusing to run integration tests against a database whose name does not contain "test": ${TEST_DATABASE_URL}`);
  }
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } });
  rmSync("./storage-test", { recursive: true, force: true });
  return () => rmSync("./storage-test", { recursive: true, force: true });
}
