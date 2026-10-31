import { prisma } from "./db";
import { markStaleBridgesOffline } from "./bridge/service";
import { expireDocuments } from "./documents/service";

/** Every ~30 s: bridge liveness. */
export async function runFastMaintenance() {
  const offline = await markStaleBridgesOffline();
  return { bridgesMarkedOffline: offline };
}

/** Every ~10 min: data retention. */
export async function runSlowMaintenance() {
  const now = new Date();
  const expiredDocuments = await expireDocuments(now);
  const sessions = await prisma.deviceSession.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } },
        { revokedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } },
      ],
    },
  });
  const codes = await prisma.bridgePairingCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } });
  return { expiredDocuments, purgedSessions: sessions.count, purgedPairingCodes: codes.count };
}
