/**
 * End-to-end API flow against a real PostgreSQL database:
 *   phone uploads PDF -> user pairs a Windows bridge -> bridge reports the HP M1005 ->
 *   user registers it -> submits a job -> bridge claims, downloads (hash-checked),
 *   spools and confirms -> usage is metered.
 * The "bridge" here is the test acting as the bridge client over the real HTTP API.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { resetRateLimits } from "@/server/rate-limit";
import { findLibreOffice } from "@/server/documents/convert";
import { call, fileForm, makePdf, resetTestDatabase, sessionCookie } from "./helpers";

import * as register from "@/app/api/auth/register/route";
import * as login from "@/app/api/auth/login/route";
import * as logout from "@/app/api/auth/logout/route";
import * as me from "@/app/api/auth/me/route";
import * as upload from "@/app/api/documents/upload/route";
import * as documents from "@/app/api/documents/route";
import * as documentById from "@/app/api/documents/[id]/route";
import * as documentFile from "@/app/api/documents/[id]/file/route";
import * as pairing from "@/app/api/bridges/pairing-code/route";
import * as bridges from "@/app/api/bridges/route";
import * as bridgeById from "@/app/api/bridges/[id]/route";
import * as bridgeRegister from "@/app/api/bridge/register/route";
import * as heartbeat from "@/app/api/bridge/heartbeat/route";
import * as bridgeJobs from "@/app/api/bridge/jobs/route";
import * as bridgeStatus from "@/app/api/bridge/jobs/[id]/status/route";
import * as bridgeDocument from "@/app/api/bridge/jobs/[id]/document/route";
import * as printers from "@/app/api/printers/route";
import * as printerRegister from "@/app/api/printers/register/route";
import * as printerById from "@/app/api/printers/[id]/route";
import * as printerTest from "@/app/api/printers/[id]/test/route";
import * as jobs from "@/app/api/print-jobs/route";
import * as jobById from "@/app/api/print-jobs/[id]/route";
import * as jobCancel from "@/app/api/print-jobs/[id]/cancel/route";
import * as jobRetry from "@/app/api/print-jobs/[id]/retry/route";
import * as adminStats from "@/app/api/admin/stats/route";

const M1005 = {
  systemName: "HP LaserJet M1005",
  driverName: "HP LaserJet M1005",
  portName: "USB001",
  isDefault: true,
  state: "READY",
  stateMessage: null,
  // Deliberately over-reporting driver: the M1005 model profile must still block colour/duplex.
  capabilities: { supportsColor: true, canDuplex: true, paperSizes: ["A4", "A5", "LETTER", "LEGAL", "B5"], resolutionsDpi: [600], maxCopies: 999 },
};

const settings = {
  copies: 2,
  pageRange: "1-2",
  paperSize: "A4",
  orientation: "PORTRAIT",
  colorMode: "MONOCHROME",
  duplex: "SIMPLEX",
  quality: "NORMAL",
  scaleMode: "FIT",
};

let alice = "";
let bob = "";
let pdfDocId = "";
let bridgeToken = "";
let bridgeId = "";
let printerId = "";
let jobId = "";

beforeAll(async () => {
  await resetTestDatabase();
  resetRateLimits();
  const a = await call(register.POST, "POST", "/api/auth/register", { body: { name: "Alice", email: "alice@example.com", password: "correct-horse-battery" } });
  expect(a.status).toBe(201);
  alice = sessionCookie(a.res);
  const b = await call(register.POST, "POST", "/api/auth/register", { body: { name: "Bob", email: "bob@example.com", password: "another-strong-pass" } });
  bob = sessionCookie(b.res);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("authentication", () => {
  it("rejects duplicate emails and wrong passwords, accepts correct login", async () => {
    const dup = await call(register.POST, "POST", "/api/auth/register", { body: { name: "A", email: "ALICE@example.com", password: "correct-horse-battery" } });
    expect(dup.status).toBe(409);
    const bad = await call(login.POST, "POST", "/api/auth/login", { body: { email: "alice@example.com", password: "nope-nope-nope" } });
    expect(bad.status).toBe(401);
    const ok = await call(login.POST, "POST", "/api/auth/login", { body: { email: "alice@example.com", password: "correct-horse-battery" } });
    expect(ok.status).toBe(200);
    expect(ok.res.headers.getSetCookie()[0]).toMatch(/HttpOnly/i);
  });

  it("returns the profile with a free plan", async () => {
    const r = await call(me.GET, "GET", "/api/auth/me", { cookie: alice });
    expect(r.status).toBe(200);
    expect(r.data.subscription.plan).toBe("FREE");
    expect(r.data.usage.pagesUsed).toBe(0);
  });

  it("blocks cross-origin mutations (CSRF)", async () => {
    const r = await call(pairing.POST, "POST", "/api/bridges/pairing-code", { cookie: alice, headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
  });

  it("forbids non-admins from the admin API", async () => {
    const r = await call(adminStats.GET, "GET", "/api/admin/stats", { cookie: alice });
    expect(r.status).toBe(403);
  });
});

describe("document upload", () => {
  it("accepts a PDF and counts pages", async () => {
    const r = await call(upload.POST, "POST", "/api/documents/upload", { cookie: alice, form: fileForm("Report.pdf", await makePdf(3), "application/pdf") });
    expect(r.status).toBe(201);
    expect(r.data.document).toMatchObject({ status: "READY", pageCount: 3, extension: "pdf", scanStatus: "SKIPPED" });
    pdfDocId = r.data.document.id;
  });

  it("converts a PNG photo to a one-page PDF", async () => {
    const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#3366cc" } }).png().toBuffer();
    const r = await call(upload.POST, "POST", "/api/documents/upload", { cookie: alice, form: fileForm("photo.png", png, "image/png") });
    expect(r.status).toBe(201);
    expect(r.data.document).toMatchObject({ status: "READY", pageCount: 1 });
  });

  it("converts plain text", async () => {
    const txt = Buffer.from(Array.from({ length: 150 }, (_, i) => `Line ${i + 1}`).join("\n"));
    const r = await call(upload.POST, "POST", "/api/documents/upload", { cookie: alice, form: fileForm("notes.txt", txt, "text/plain") });
    expect(r.status).toBe(201);
    expect(r.data.document.pageCount).toBe(3);
  });

  it("rejects content that does not match the extension", async () => {
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 1)]);
    const r = await call(upload.POST, "POST", "/api/documents/upload", { cookie: alice, form: fileForm("invoice.pdf", exe, "application/pdf") });
    expect(r.status).toBe(422);
    expect(r.data.error.code).toBe("CONTENT_MISMATCH");
  });

  it("rejects unsupported extensions", async () => {
    const r = await call(upload.POST, "POST", "/api/documents/upload", { cookie: alice, form: fileForm("run.exe", Buffer.from("MZ..."), "application/octet-stream") });
    expect(r.status).toBe(422);
    expect(r.data.error.code).toBe("UNSUPPORTED_TYPE");
  });

  it.skipIf(!!findLibreOffice())("reports clearly when Office conversion is unavailable", async () => {
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("[Content_Types].xml word/document.xml")]);
    const r = await call(upload.POST, "POST", "/api/documents/upload", { cookie: alice, form: fileForm("letter.docx", docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document") });
    expect(r.status).toBe(422);
    expect(r.data.error.code).toBe("CONVERSION_UNAVAILABLE");
  });

  it("serves the PDF via signed URL and isolates other users", async () => {
    const detail = await call(documentById.GET, "GET", `/api/documents/${pdfDocId}`, { cookie: alice, params: { id: pdfDocId } });
    expect(detail.status).toBe(200);
    const signed = new URL(detail.data.document.pdfUrl, "http://localhost:3000");
    const viaToken = await call(documentFile.GET, "GET", signed.pathname + signed.search, { params: { id: pdfDocId } });
    expect(viaToken.status).toBe(200);
    expect(viaToken.res.headers.get("content-type")).toBe("application/pdf");

    const bobDetail = await call(documentById.GET, "GET", `/api/documents/${pdfDocId}`, { cookie: bob, params: { id: pdfDocId } });
    expect(bobDetail.status).toBe(404);
    const bobFile = await call(documentFile.GET, "GET", `/api/documents/${pdfDocId}/file?variant=pdf`, { cookie: bob, params: { id: pdfDocId } });
    expect(bobFile.status).toBe(404);
    const forged = await call(documentFile.GET, "GET", `/api/documents/${pdfDocId}/file?variant=pdf&token=abc.def`, { params: { id: pdfDocId } });
    expect(forged.status).toBe(404);

    const list = await call(documents.GET, "GET", "/api/documents", { cookie: alice });
    expect(list.data.items.length).toBe(3);
    const bobList = await call(documents.GET, "GET", "/api/documents", { cookie: bob });
    expect(bobList.data.items.length).toBe(0);
  });
});

describe("bridge pairing and printer registration", () => {
  it("pairs a bridge with a one-time code", async () => {
    const code = await call(pairing.POST, "POST", "/api/bridges/pairing-code", { cookie: alice });
    expect(code.status).toBe(201);
    expect(code.data.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const reg = await call(bridgeRegister.POST, "POST", "/api/bridge/register", {
      headers: { origin: "" },
      body: { pairingCode: code.data.code.toLowerCase().replace("-", " "), name: "FRONT-DESK-PC", os: "Windows 10 Pro 22H2", appVersion: "1.0.0" },
    });
    expect(reg.status).toBe(201);
    bridgeToken = reg.data.bridgeToken;
    bridgeId = reg.data.bridgeId;
    expect(bridgeToken.startsWith(`${bridgeId}.`)).toBe(true);

    const reuse = await call(bridgeRegister.POST, "POST", "/api/bridge/register", { body: { pairingCode: code.data.code, name: "X" } });
    expect(reuse.status).toBe(400);
  });

  it("rejects bad bridge credentials", async () => {
    const r = await call(heartbeat.POST, "POST", "/api/bridge/heartbeat", { bearer: `${bridgeId}.wrong-secret`, body: { printers: [] } });
    expect(r.status).toBe(401);
  });

  it("accepts a heartbeat with the detected HP M1005", async () => {
    const r = await call(heartbeat.POST, "POST", "/api/bridge/heartbeat", { bearer: bridgeToken, body: { appVersion: "1.0.0", paused: false, printers: [M1005] } });
    expect(r.status).toBe(200);
    expect(r.data.cancelJobIds).toEqual([]);

    const list = await call(bridges.GET, "GET", "/api/bridges", { cookie: alice });
    const detected = list.data.bridges[0].detectedPrinters[0];
    expect(list.data.bridges[0].online).toBe(true);
    expect(detected).toMatchObject({ systemName: "HP LaserJet M1005", modelKey: "HP_LJ_M1005", connection: "USB", registeredPrinterId: null });
  });

  it("registers the printer with mono/simplex capabilities regardless of driver over-reporting", async () => {
    const r = await call(printerRegister.POST, "POST", "/api/printers/register", { cookie: alice, body: { bridgeId, systemName: M1005.systemName, name: "Office M1005" } });
    expect(r.status).toBe(201);
    printerId = r.data.printer.id;
    expect(r.data.printer.capabilities).toMatchObject({ color: false, duplex: false, paperSizes: ["A4", "A5", "LETTER", "LEGAL"], maxCopies: 99, source: "DRIVER" });
    expect(r.data.printer.available).toBe(true);

    const again = await call(printerRegister.POST, "POST", "/api/printers/register", { cookie: alice, body: { bridgeId, systemName: M1005.systemName, name: "Dup" } });
    expect(again.status).toBe(409);
    const bobTry = await call(printerRegister.POST, "POST", "/api/printers/register", { cookie: bob, body: { bridgeId, systemName: M1005.systemName, name: "Steal" } });
    expect(bobTry.status).toBe(404);
  });

  it("enforces the free plan printer limit", async () => {
    await call(heartbeat.POST, "POST", "/api/bridge/heartbeat", {
      bearer: bridgeToken,
      body: { printers: [M1005, { ...M1005, systemName: "Microsoft Print to PDF", driverName: "Microsoft Print To PDF", portName: "PORTPROMPT:", isDefault: false }] },
    });
    const r = await call(printerRegister.POST, "POST", "/api/printers/register", { cookie: alice, body: { bridgeId, systemName: "Microsoft Print to PDF", name: "PDF" } });
    expect(r.status).toBe(403);
    expect(r.data.error.code).toBe("PLAN_LIMIT");
  });
});

describe("print job lifecycle", () => {
  it("rejects settings the M1005 cannot do", async () => {
    for (const [patch, field] of [
      [{ colorMode: "COLOR" }, "colorMode"],
      [{ duplex: "LONG_EDGE" }, "duplex"],
      [{ pageRange: "2-9" }, "pageRange"],
      [{ quality: "HIGH" }, "quality"],
    ] as const) {
      const r = await call(jobs.POST, "POST", "/api/print-jobs", { cookie: alice, body: { documentId: pdfDocId, printerId, settings: { ...settings, ...patch } } });
      expect(r.status, field).toBe(400);
      expect(r.data.error.details.fields[field]).toBeTruthy();
    }
  });

  it("isolates printers between users", async () => {
    const r = await call(jobs.POST, "POST", "/api/print-jobs", { cookie: bob, body: { documentId: pdfDocId, printerId, settings } });
    expect(r.status).toBe(404);
  });

  it("queues a valid job", async () => {
    const r = await call(jobs.POST, "POST", "/api/print-jobs", { cookie: alice, body: { documentId: pdfDocId, printerId, settings } });
    expect(r.status).toBe(201);
    expect(r.data.job).toMatchObject({ status: "QUEUED", pagesSelected: 2, copies: 2, totalPages: 4, pageRange: "1-2" });
    jobId = r.data.job.id;
    const bobView = await call(jobById.GET, "GET", `/api/print-jobs/${jobId}`, { cookie: bob, params: { id: jobId } });
    expect(bobView.status).toBe(404);
  });

  it("does not hand jobs to a bridge for printers it says are not ready", async () => {
    const r = await call(bridgeJobs.GET, "GET", "/api/bridge/jobs?ready=", { bearer: bridgeToken });
    expect(r.data.jobs).toEqual([]);
  });

  it("lets the bridge claim, download (hash-verified) and confirm the job", async () => {
    const first = await call(bridgeJobs.GET, "GET", `/api/bridge/jobs?ready=${printerId}`, { bearer: bridgeToken });
    expect(first.data.jobs).toHaveLength(1);
    const job = first.data.jobs[0];
    expect(job).toMatchObject({ id: jobId, attempt: 1, printerSystemName: "HP LaserJet M1005", status: "PROCESSING" });
    expect(job.settings).toMatchObject({ pages: [1, 2], copies: 2, colorMode: "MONOCHROME", dpi: 600 });

    // Second poll returns the same in-flight job (crash recovery) — not a second claim.
    const second = await call(bridgeJobs.GET, "GET", `/api/bridge/jobs?ready=${printerId}`, { bearer: bridgeToken });
    expect(second.data.jobs.map((j: { id: string }) => j.id)).toEqual([jobId]);
    expect(second.data.jobs[0].status).toBe("PROCESSING");

    const url = new URL(job.document.downloadUrl, "http://localhost:3000");
    const dl = await call(bridgeDocument.GET, "GET", url.pathname + url.search, { bearer: bridgeToken, params: { id: jobId } });
    expect(dl.status).toBe(200);
    const bytes = Buffer.from(await dl.res.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(job.document.sha256);

    const noToken = await call(bridgeDocument.GET, "GET", url.pathname, { bearer: bridgeToken, params: { id: jobId } });
    expect(noToken.status).toBe(404);
    const noAuth = await call(bridgeDocument.GET, "GET", url.pathname + url.search, { params: { id: jobId } });
    expect(noAuth.status).toBe(401);

    const premature = await call(bridgeStatus.POST, "POST", `/api/bridge/jobs/${jobId}/status`, { bearer: bridgeToken, params: { id: jobId }, body: { attempt: 1, status: "COMPLETED" } });
    expect(premature.status).toBe(400);
    expect(premature.data.error.code).toBe("CONFIRMATION_REQUIRED");

    const printing = await call(bridgeStatus.POST, "POST", `/api/bridge/jobs/${jobId}/status`, { bearer: bridgeToken, params: { id: jobId }, body: { attempt: 1, status: "PRINTING", spoolJobId: 42 } });
    expect(printing.data.status).toBe("PRINTING");

    const alert = await call(bridgeStatus.POST, "POST", `/api/bridge/jobs/${jobId}/status`, { bearer: bridgeToken, params: { id: jobId }, body: { attempt: 1, status: "PRINTING", printerAlert: "Printer is out of paper" } });
    expect(alert.status).toBe(200);

    const done = await call(bridgeStatus.POST, "POST", `/api/bridge/jobs/${jobId}/status`, {
      bearer: bridgeToken,
      params: { id: jobId },
      body: { attempt: 1, status: "COMPLETED", pagesPrinted: 4, confirmation: { source: "SPOOLER_PRINTED_FLAG" } },
    });
    expect(done.data.status).toBe("COMPLETED");

    const repeat = await call(bridgeStatus.POST, "POST", `/api/bridge/jobs/${jobId}/status`, {
      bearer: bridgeToken,
      params: { id: jobId },
      body: { attempt: 1, status: "COMPLETED", confirmation: { source: "SPOOLER_PRINTED_FLAG" } },
    });
    expect(repeat.status).toBe(200);
    const late = await call(bridgeStatus.POST, "POST", `/api/bridge/jobs/${jobId}/status`, { bearer: bridgeToken, params: { id: jobId }, body: { attempt: 1, status: "FAILED", message: "late" } });
    expect(late.status).toBe(409);

    const detail = await call(jobById.GET, "GET", `/api/print-jobs/${jobId}`, { cookie: alice, params: { id: jobId } });
    expect(detail.data.job.status).toBe("COMPLETED");
    expect(detail.data.job.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(["submitted", "queued", "claimed", "spooled", "printer_alert", "completed"]),
    );
    const usage = await call(me.GET, "GET", "/api/auth/me", { cookie: alice });
    expect(usage.data.usage.pagesUsed).toBe(4);
    expect(await prisma.usageRecord.count({ where: { printJobId: jobId } })).toBe(1);
  });

  it("cancels queued jobs immediately and retries them as a new attempt", async () => {
    const created = await call(jobs.POST, "POST", "/api/print-jobs", { cookie: alice, body: { documentId: pdfDocId, printerId, settings: { ...settings, copies: 1 } } });
    const id = created.data.job.id;
    const cancelled = await call(jobCancel.POST, "POST", `/api/print-jobs/${id}/cancel`, { cookie: alice, params: { id } });
    expect(cancelled.data.job.status).toBe("CANCELLED");

    const retried = await call(jobRetry.POST, "POST", `/api/print-jobs/${id}/retry`, { cookie: alice, params: { id } });
    expect(retried.data.job).toMatchObject({ status: "QUEUED", attempt: 2 });

    const claimed = await call(bridgeJobs.GET, "GET", `/api/bridge/jobs?ready=${printerId}`, { bearer: bridgeToken });
    expect(claimed.data.jobs.find((j: { id: string }) => j.id === id).attempt).toBe(2);

    const stale = await call(bridgeStatus.POST, "POST", `/api/bridge/jobs/${id}/status`, { bearer: bridgeToken, params: { id }, body: { attempt: 1, status: "PRINTING", spoolJobId: 7 } });
    expect(stale.status).toBe(409);
    expect(stale.data.error.code).toBe("STALE_ATTEMPT");

    await call(bridgeStatus.POST, "POST", `/api/bridge/jobs/${id}/status`, { bearer: bridgeToken, params: { id }, body: { attempt: 2, status: "PRINTING", spoolJobId: 8 } });
    const cancelReq = await call(jobCancel.POST, "POST", `/api/print-jobs/${id}/cancel`, { cookie: alice, params: { id } });
    expect(cancelReq.data.job).toMatchObject({ status: "PRINTING", cancelRequested: true });

    const hb = await call(heartbeat.POST, "POST", "/api/bridge/heartbeat", { bearer: bridgeToken, body: { printers: [M1005] } });
    expect(hb.data.cancelJobIds).toContain(id);

    const confirm = await call(bridgeStatus.POST, "POST", `/api/bridge/jobs/${id}/status`, { bearer: bridgeToken, params: { id }, body: { attempt: 2, status: "CANCELLED" } });
    expect(confirm.data.status).toBe("CANCELLED");
  });

  it("lets the bridge release a job before spooling when the printer goes offline", async () => {
    const created = await call(jobs.POST, "POST", "/api/print-jobs", { cookie: alice, body: { documentId: pdfDocId, printerId, settings: { ...settings, copies: 1 } } });
    const id = created.data.job.id;
    await call(bridgeJobs.GET, "GET", `/api/bridge/jobs?ready=${printerId}`, { bearer: bridgeToken });
    const release = await call(bridgeStatus.POST, "POST", `/api/bridge/jobs/${id}/status`, {
      bearer: bridgeToken,
      params: { id },
      body: { attempt: 1, status: "QUEUED", errorCode: "PRINTER_OFFLINE", message: "Printer went offline", printerState: "OFFLINE" },
    });
    expect(release.data.status).toBe("QUEUED");
    const printer = await call(printerById.GET, "GET", `/api/printers/${printerId}`, { cookie: alice, params: { id: printerId } });
    expect(printer.data.printer.state).toBe("OFFLINE");
    expect(printer.data.printer.available).toBe(false);
    await call(jobCancel.POST, "POST", `/api/print-jobs/${id}/cancel`, { cookie: alice, params: { id } });
    await call(heartbeat.POST, "POST", "/api/bridge/heartbeat", { bearer: bridgeToken, body: { printers: [M1005] } });
  });

  it("refuses to delete a document that is still printing", async () => {
    const created = await call(jobs.POST, "POST", "/api/print-jobs", { cookie: alice, body: { documentId: pdfDocId, printerId, settings: { ...settings, copies: 1 } } });
    const del = await call(documentById.DELETE, "DELETE", `/api/documents/${pdfDocId}`, { cookie: alice, params: { id: pdfDocId } });
    expect(del.status).toBe(409);
    await call(jobCancel.POST, "POST", `/api/print-jobs/${created.data.job.id}/cancel`, { cookie: alice, params: { id: created.data.job.id } });
  });

  it("enforces the monthly page quota", async () => {
    await prisma.subscription.updateMany({ where: { user: { email: "alice@example.com" } }, data: { monthlyPageLimit: 6 } });
    const r = await call(jobs.POST, "POST", "/api/print-jobs", { cookie: alice, body: { documentId: pdfDocId, printerId, settings: { ...settings, pageRange: null, copies: 1 } } });
    expect(r.status).toBe(403);
    expect(r.data.error.code).toBe("QUOTA_EXCEEDED");
    await prisma.subscription.updateMany({ where: { user: { email: "alice@example.com" } }, data: { monthlyPageLimit: 100 } });
  });

  it("sends a test page through the normal pipeline", async () => {
    const r = await call(printerTest.POST, "POST", `/api/printers/${printerId}/test`, { cookie: alice, params: { id: printerId } });
    expect(r.status).toBe(201);
    expect(r.data.job).toMatchObject({ isTest: true, status: "QUEUED", documentName: "PrintShare test page.pdf" });
    const listed = await call(jobs.GET, "GET", "/api/print-jobs?status=QUEUED", { cookie: alice });
    expect(listed.data.items.some((j: { isTest: boolean }) => j.isTest)).toBe(true);
  });
});

describe("revocation and logout", () => {
  it("revoked bridges lose access and their queued jobs fail", async () => {
    const r = await call(bridgeById.DELETE, "DELETE", `/api/bridges/${bridgeId}`, { cookie: alice, params: { id: bridgeId } });
    expect(r.status).toBe(200);
    const hb = await call(heartbeat.POST, "POST", "/api/bridge/heartbeat", { bearer: bridgeToken, body: { printers: [] } });
    expect(hb.status).toBe(401);
    const queued = await prisma.printJob.count({ where: { printerId, status: "QUEUED" } });
    expect(queued).toBe(0);
    const p = await call(printers.GET, "GET", "/api/printers", { cookie: alice });
    expect(p.data.printers[0].available).toBe(false);
  });

  it("logout invalidates the session", async () => {
    await call(logout.POST, "POST", "/api/auth/logout", { cookie: alice });
    const r = await call(me.GET, "GET", "/api/auth/me", { cookie: alice });
    expect(r.status).toBe(401);
  });
});
