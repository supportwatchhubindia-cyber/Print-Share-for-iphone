import { PrismaClient } from "@prisma/client";

// One client per process. Route handlers and server.ts are bundled separately,
// so the instance is pinned on globalThis to avoid duplicate pools.
const globalForPrisma = globalThis as unknown as { __printsharePrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__printsharePrisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

globalForPrisma.__printsharePrisma = prisma;
