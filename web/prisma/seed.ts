/**
 * Seeds the administrator account from ADMIN_EMAIL / ADMIN_PASSWORD.
 * Deliberately creates no printers, bridges or jobs: printers only appear when a real
 * PrintShare Bridge reports them, so nothing in the UI is a fake connection.
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { PLANS } from "../src/lib/plans";

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "PrintShare Admin";
  if (!email || !password) {
    console.log("[seed] ADMIN_EMAIL / ADMIN_PASSWORD not set — nothing to seed.");
    return;
  }
  if (password.length < 10) throw new Error("ADMIN_PASSWORD must be at least 10 characters.");

  const existing = await prisma.user.findUnique({ where: { email } });
  const user = existing
    ? await prisma.user.update({ where: { email }, data: { role: "ADMIN", status: "ACTIVE" } })
    : await prisma.user.create({ data: { email, name, role: "ADMIN", passwordHash: await hashPassword(password) } });

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  await prisma.subscription.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      plan: "BUSINESS",
      monthlyPageLimit: PLANS.BUSINESS.monthlyPageLimit,
      maxPrinters: PLANS.BUSINESS.maxPrinters,
      currentPeriodStart: start,
      currentPeriodEnd: end,
    },
    update: {},
  });
  console.log(`[seed] admin ${existing ? "promoted" : "created"}: ${email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
