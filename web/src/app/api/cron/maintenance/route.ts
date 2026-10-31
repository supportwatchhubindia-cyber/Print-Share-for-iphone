import type { NextRequest } from "next/server";
import { env } from "@/server/env";
import { safeEqual } from "@/server/crypto";
import { runFastMaintenance, runSlowMaintenance } from "@/server/maintenance";

export const maxDuration = 60;

/**
 * Retention + bridge liveness for serverless deployments (vercel.json "crons").
 * Vercel Cron calls it with "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(req: NextRequest) {
  const secret = env().CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const fast = await runFastMaintenance();
  const slow = await runSlowMaintenance();
  return Response.json({ ok: true, ...fast, ...slow }, { headers: { "Cache-Control": "no-store" } });
}
