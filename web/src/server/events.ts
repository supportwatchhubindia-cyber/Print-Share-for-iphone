import { prisma } from "./db";
import { realtimeTransport } from "./env";
import type { ClientRealtimeEvent } from "@/lib/types";

export const EVENTS_CHANNEL = "printshare_events";

/** Commands pushed to a Windows bridge over its WebSocket. */
export type BridgeRealtimeEvent =
  | { type: "job.available" }
  | { type: "job.cancel"; jobId: string }
  | { type: "printers.refresh" }
  | { type: "bridge.revoked" };

export type EventEnvelope =
  | { target: { userId: string }; event: ClientRealtimeEvent }
  | { target: { bridgeId: string }; event: BridgeRealtimeEvent };

/**
 * Publishes through PostgreSQL NOTIFY. server.ts LISTENs and fans out to sockets,
 * which works across processes/instances without extra infrastructure.
 * Delivery is best-effort: clients also refetch on reconnect.
 */
async function publish(envelope: EventEnvelope) {
  // Serverless deployments have no WebSocket listener; browsers poll and bridges long-poll instead.
  if (realtimeTransport() === "poll") return;
  try {
    await prisma.$executeRaw`SELECT pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(envelope)})`;
  } catch (err) {
    console.error("[events] publish failed", err);
  }
}

export function notifyUser(userId: string, event: ClientRealtimeEvent) {
  return publish({ target: { userId }, event });
}

export function notifyBridge(bridgeId: string, event: BridgeRealtimeEvent) {
  return publish({ target: { bridgeId }, event });
}
