/**
 * Serverless (Vercel) code paths that can run against the local storage driver:
 * browser-to-Blob ingest, bridge long-polling and the maintenance cron endpoint.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { resetEnvCache } from "@/server/env";
import { resetRateLimits } from "@/server/rate-limit";
import { openObject, writeObject } from "@/server/storage";
import { call, makePdf, resetTestDatabase, sessionCookie } from "./helpers";

import * as register from "@/app/api/auth/register/route";
import * as ingest from "@/app/api/documents/ingest/route";
import * as pairing from "@/app/api/bridges/pairing-code/route";
import * as bridgeRegister from "@/app/api/bridge/register/route";
import * as heartbeat from "@/app/api/bridge/heartbeat/route";
import * as bridgeJobs from "@/app/api/bridge/jobs/route";
import * as printerRegister from "@/app/api/printers/register/route";
import * as jobs from "@/app/api/print-jobs/route";
import * as cron from "@/app/api/cron/maintenance/route";

const PRINTER = {
  systemName: "HP LaserJet M1005",
  driverName: "HP LaserJet M1005",
  portName: "USB001",
  isDefault: true,
  state: "READY",
  capabilities: { supportsColor: false, canDuplex: false, paperSizes: ["A4"], resolutionsDpi: [600], maxCopies: 99 },
};

let cookie = "";
let userId = "";
let bridgeToken = "";
let printerId = "";
let documentId = "";

beforeAll(async () => {
  await resetTestDatabase();
  resetRateLimits();
  const r = await call(register.POST, "POST", "/api/auth/register", { body: { name: "Vera", email: "vera@example.com", password: "serverless-pass-123" } });
  cookie = sessionCookie(r.res);
  userId = r.data.user.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const incoming = (owner: string, ext = "pdf") => `incoming/${owner}/${randomBytes(16).toString("hex")}.${ext}`;

describe("ingest after a direct-to-storage upload", () => {
  it("processes the uploaded object and removes the temporary copy", async () => {
    const pathname = incoming(userId);
    await writeObject(pathname, await makePdf(2), "application/pdf");
    const r = await call(ingest.POST, "POST", "/api/documents/ingest", { cookie, body: { pathname, name: "Scan from iPhone.pdf" } });
    expect(r.status).toBe(201);
    expect(r.data.document).toMatchObject({ status: "READY", pageCount: 2, name: "Scan from iPhone.pdf" });
    documentId = r.data.document.id;
    expect(await openObject(pathname)).toBeNull();
  });

  it("refuses objects in another user's folder and missing uploads", async () => {
    const theirs = incoming("someoneelse123");
    await writeObject(theirs, await makePdf(1));
    expect((await call(ingest.POST, "POST", "/api/documents/ingest", { cookie, body: { pathname: theirs, name: "x.pdf" } })).status).toBe(403);
    expect((await call(ingest.POST, "POST", "/api/documents/ingest", { cookie, body: { pathname: incoming(userId), name: "x.pdf" } })).status).toBe(404);
    expect((await call(ingest.POST, "POST", "/api/documents/ingest", { cookie, body: { pathname: `${userId}/doc/original.pdf`, name: "x.pdf" } })).status).toBe(403);
  });

  it("still validates content (renamed files are rejected)", async () => {
    const pathname = incoming(userId);
    await writeObject(pathname, Buffer.from("MZ not a pdf"));
    const r = await call(ingest.POST, "POST", "/api/documents/ingest", { cookie, body: { pathname, name: "invoice.pdf" } });
    expect(r.status).toBe(422);
    expect(r.data.error.code).toBe("CONTENT_MISMATCH");
    expect(await openObject(pathname)).toBeNull();
  });
});

describe("bridge long-poll", () => {
  beforeAll(async () => {
    const code = await call(pairing.POST, "POST", "/api/bridges/pairing-code", { cookie });
    const reg = await call(bridgeRegister.POST, "POST", "/api/bridge/register", { body: { pairingCode: code.data.code, name: "PC" } });
    bridgeToken = reg.data.bridgeToken;
    const hb = await call(heartbeat.POST, "POST", "/api/bridge/heartbeat", { bearer: bridgeToken, body: { printers: [PRINTER] } });
    expect(hb.data).toMatchObject({ realtime: true, longPollSeconds: 0, pollIntervalSeconds: 15 }); // self-hosted defaults
    const p = await call(printerRegister.POST, "POST", "/api/printers/register", { cookie, body: { bridgeId: reg.data.bridgeId, systemName: PRINTER.systemName, name: "M1005" } });
    printerId = p.data.printer.id;
  });

  it("holds the request while idle", async () => {
    const t0 = Date.now();
    const r = await call(bridgeJobs.GET, "GET", `/api/bridge/jobs?ready=${printerId}&wait=2`, { bearer: bridgeToken });
    expect(r.data.jobs).toEqual([]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1900);
  });

  it("returns as soon as a job is queued", async () => {
    const t0 = Date.now();
    const waiting = call(bridgeJobs.GET, "GET", `/api/bridge/jobs?ready=${printerId}&wait=15`, { bearer: bridgeToken });
    await new Promise((r) => setTimeout(r, 400));
    const created = await call(jobs.POST, "POST", "/api/print-jobs", {
      cookie,
      body: { documentId, printerId, settings: { copies: 1, paperSize: "A4", orientation: "PORTRAIT", colorMode: "MONOCHROME", duplex: "SIMPLEX", quality: "NORMAL", scaleMode: "FIT" } },
    });
    expect(created.status).toBe(201);
    const r = await waiting;
    expect(r.data.jobs.map((j: { id: string }) => j.id)).toEqual([created.data.job.id]);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe("maintenance cron", () => {
  it("requires CRON_SECRET and the matching bearer token", async () => {
    expect((await call(cron.GET, "GET", "/api/cron/maintenance")).status).toBe(503);
    process.env.CRON_SECRET = "cron-secret-for-tests";
    resetEnvCache();
    try {
      expect((await call(cron.GET, "GET", "/api/cron/maintenance", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
      const ok = await call(cron.GET, "GET", "/api/cron/maintenance", { headers: { authorization: "Bearer cron-secret-for-tests" } });
      expect(ok.status).toBe(200);
      expect(ok.data).toMatchObject({ ok: true, expiredDocuments: 0 });
    } finally {
      delete process.env.CRON_SECRET;
      resetEnvCache();
    }
  });
});
