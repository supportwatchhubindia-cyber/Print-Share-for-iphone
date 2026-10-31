import type { ActorType, Prisma } from "@prisma/client";
import { prisma } from "./db";

export type AuditEntry = {
  action: string;
  actorType: ActorType;
  actorId?: string | null;
  userId?: string | null;
  targetType?: string;
  targetId?: string;
  req?: Request;
  metadata?: Prisma.InputJsonValue;
};

/** Append-only audit trail. Never throws: auditing must not break the request. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        userId: entry.userId ?? null,
        targetType: entry.targetType,
        targetId: entry.targetId,
        ipAddress: entry.req?.headers.get("x-ps-client-ip") ?? null,
        userAgent: entry.req?.headers.get("user-agent")?.slice(0, 300) ?? null,
        metadata: entry.metadata,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log", entry.action, err);
  }
}
