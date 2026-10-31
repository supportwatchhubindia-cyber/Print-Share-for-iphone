import { createServer, type Server } from "node:http";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { gotenbergToPdf } from "@/server/documents/convert";
import { INCOMING_PATTERN, deletePrefix, openObject, presignedObjectUrl, readObject, writeObject } from "@/server/storage";
import { middleware } from "@/middleware";
import { refreshEvery } from "@/lib/realtime-config";

describe("Gotenberg Office conversion client", () => {
  let server: Server;
  let base = "";
  const seen: { path?: string; auth?: string; body?: string } = {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen.path = req.url;
        seen.auth = req.headers.authorization;
        seen.body = Buffer.concat(chunks).toString("latin1");
        if (seen.body.includes("BROKEN")) {
          res.writeHead(400).end("LibreOffice failed");
          return;
        }
        res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF-1.7 converted");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("posts the file as multipart 'files' to /forms/libreoffice/convert", async () => {
    const pdf = await gotenbergToPdf(Buffer.from("PK docx bytes"), "docx", base, "user:pass");
    expect(pdf.toString()).toBe("%PDF-1.7 converted");
    expect(seen.path).toBe("/forms/libreoffice/convert");
    expect(seen.auth).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
    expect(seen.body).toMatch(/name="files"; filename="document\.docx"/);
  });

  it("maps converter errors and outages to CONVERSION_FAILED", async () => {
    await expect(gotenbergToPdf(Buffer.from("BROKEN"), "xlsx", base)).rejects.toMatchObject({ code: "CONVERSION_FAILED" });
    await expect(gotenbergToPdf(Buffer.from("x"), "pptx", "http://127.0.0.1:1")).rejects.toMatchObject({ code: "CONVERSION_FAILED" });
  });
});

describe("local storage driver", () => {
  afterAll(() => rmSync("./storage-test", { recursive: true, force: true }));

  it("writes, streams, reads with a size cap and deletes by prefix", async () => {
    await writeObject("u1/d1/original.pdf", Buffer.from("%PDF-1.7 hello"), "application/pdf");
    const opened = await openObject("u1/d1/original.pdf");
    expect(opened?.size).toBe(14);
    await opened?.stream.cancel();
    expect((await readObject("u1/d1/original.pdf", 100))?.toString()).toBe("%PDF-1.7 hello");
    await expect(readObject("u1/d1/original.pdf", 5)).rejects.toBeInstanceOf(RangeError);
    expect(await presignedObjectUrl("u1/d1/original.pdf", 60)).toBeNull(); // local files are streamed by the app
    await deletePrefix("u1/d1");
    expect(await openObject("u1/d1/original.pdf")).toBeNull();
  });
});

describe("browser-to-Blob upload paths", () => {
  it("only accepts incoming/<userId>/<random>.<allowed ext>", () => {
    expect(INCOMING_PATTERN.exec("incoming/cmvvww0cy0008tawc/0123456789abcdef0123456789abcdef.pdf")?.[1]).toBe("cmvvww0cy0008tawc");
    expect(INCOMING_PATTERN.test("incoming/cmvvww0cy0008tawc/../other/0123456789abcdef0123456789abcdef.pdf")).toBe(false);
    expect(INCOMING_PATTERN.test("incoming/cmvvww0cy0008tawc/0123456789abcdef0123456789abcdef.exe")).toBe(false);
    expect(INCOMING_PATTERN.test("docs/cmvvww0cy0008tawc/0123456789abcdef0123456789abcdef.pdf")).toBe(false);
    expect(INCOMING_PATTERN.test("incoming/cmvvww0cy0008tawc/short.pdf")).toBe(false);
  });
});

describe("middleware", () => {
  it("records the path, and on Vercel overwrites spoofed client IP / proto headers", () => {
    const prev = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      const req = new NextRequest("https://print.example.com/api/auth/login", {
        headers: { "x-ps-client-ip": "6.6.6.6", "x-real-ip": "203.0.113.9", "x-forwarded-proto": "https" },
      });
      const res = middleware(req);
      expect(res.headers.get("x-middleware-request-x-ps-client-ip")).toBe("203.0.113.9");
      expect(res.headers.get("x-middleware-request-x-ps-proto")).toBe("https");
      expect(res.headers.get("x-middleware-request-x-ps-path")).toBe("/api/auth/login");
    } finally {
      if (prev === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prev;
    }
  });

  it("leaves IP headers to server.ts when self-hosted", () => {
    delete process.env.VERCEL;
    const res = middleware(new NextRequest("http://localhost:3000/dashboard"));
    expect(res.headers.get("x-middleware-request-x-ps-client-ip")).toBeNull();
    expect(res.headers.get("x-middleware-request-x-ps-path")).toBe("/dashboard");
  });
});

describe("refresh intervals", () => {
  it("use the slow safety net when WebSockets are available", () => {
    expect(refreshEvery(3000, 20000)(true)).toBe(60_000);
  });
});
