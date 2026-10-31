/**
 * One-off retention run (the server also does this every 10 minutes).
 * Useful as a cron job when running several instances or for manual cleanup.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { runFastMaintenance, runSlowMaintenance } = await import("../src/server/maintenance");
  const { prisma } = await import("../src/server/db");
  try {
    console.log("[cleanup]", await runFastMaintenance());
    console.log("[cleanup]", await runSlowMaintenance());
  } finally {
    await prisma.$disconnect();
  }
}

void main();
