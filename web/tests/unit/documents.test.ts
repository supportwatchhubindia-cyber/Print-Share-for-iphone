import { createServer, type Server } from "node:net";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateContent } from "@/server/documents/detect";
import { ConversionError, imageToPdf, inspectPdf, textToPdf } from "@/server/documents/convert";
import { clamdInstream, clamdPing } from "@/server/documents/scan";

const zip = (folder: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`[Content_Types].xml ${folder}x.xml`)]);

describe("content validation (magic bytes)", () => {
  it("accepts genuine signatures", () => {
    expect(validateContent("pdf", Buffer.from("%PDF-1.7\n..."))).toEqual({ ok: true });
    expect(validateContent("jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toEqual({ ok: true });
    expect(validateContent("png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toEqual({ ok: true });
    expect(validateContent("docx", zip("word/"))).toEqual({ ok: true });
    expect(validateContent("xlsx", zip("xl/"))).toEqual({ ok: true });
    expect(validateContent("pptx", zip("ppt/"))).toEqual({ ok: true });
    expect(validateContent("txt", Buffer.from("hello\nworld\t!"))).toEqual({ ok: true });
  });

  it("rejects mismatches", () => {
    expect(validateContent("pdf", Buffer.from("MZ\x90\x00")).ok).toBe(false);
    expect(validateContent("docx", zip("xl/")).ok).toBe(false);
    expect(validateContent("png", Buffer.from([0xff, 0xd8, 0xff])).ok).toBe(false);
    expect(validateContent("txt", Buffer.from([0x4d, 0x5a, 0x00, 0x01])).ok).toBe(false);
    expect(validateContent("pdf", Buffer.alloc(0)).ok).toBe(false);
  });
});

describe("conversion to print-ready PDF", () => {
  it("turns a landscape JPEG into a single landscape A4 page", async () => {
    const jpg = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#808080" } }).jpeg().toBuffer();
    const pdf = await PDFDocument.load(await imageToPdf(jpg));
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
    expect(Math.round(width)).toBe(842);
  });

  it("flattens transparent PNGs", async () => {
    const png = await sharp({ create: { width: 400, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const pdf = await PDFDocument.load(await imageToPdf(png));
    expect(pdf.getPage(0).getSize().height).toBeGreaterThan(pdf.getPage(0).getSize().width);
  });

  it("paginates text and replaces unsupported characters", async () => {
    const text = `${"x".repeat(200)}\nनमस्ते ✓\n` + Array.from({ length: 70 }, (_, i) => `row ${i}`).join("\n");
    const pdf = await PDFDocument.load(await textToPdf(Buffer.from(text)));
    expect(pdf.getPageCount()).toBe(2);
  });

  it("rejects corrupt images and PDFs", async () => {
    await expect(imageToPdf(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]))).rejects.toBeInstanceOf(ConversionError);
    await expect(inspectPdf(Buffer.from("%PDF-1.4 garbage"))).rejects.toMatchObject({ code: "INVALID_PDF" });
  });

  it("counts PDF pages", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    expect(await inspectPdf(await doc.save())).toEqual({ pageCount: 2 });
  });
});

describe("ClamAV INSTREAM client", () => {
  let server: Server;
  let port = 0;
  const received: Buffer[] = [];

  beforeAll(async () => {
    // Minimal clamd stand-in implementing the INSTREAM framing.
    server = createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.toString("latin1").startsWith("zPING\0")) {
          socket.end("PONG\0");
          return;
        }
        const header = "zINSTREAM\0".length;
        let offset = header;
        const parts: Buffer[] = [];
        while (buf.length >= offset + 4) {
          const len = buf.readUInt32BE(offset);
          if (len === 0) {
            const body = Buffer.concat(parts);
            received.push(body);
            socket.end(body.includes("EICAR") ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
            return;
          }
          if (buf.length < offset + 4 + len) return;
          parts.push(buf.subarray(offset + 4, offset + 4 + len));
          offset += 4 + len;
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("reports clean files and streams them in chunks", async () => {
    const data = Buffer.alloc(150_000, 7);
    expect(await clamdInstream("127.0.0.1", port, data)).toEqual({ status: "CLEAN" });
    expect(received.at(-1)!.equals(data)).toBe(true);
  });

  it("reports infected files with the signature", async () => {
    expect(await clamdInstream("127.0.0.1", port, Buffer.from("X5O!P%@AP EICAR test"))).toEqual({ status: "INFECTED", detail: "Eicar-Test-Signature" });
  });

  it("answers health pings and reports unreachable scanners as errors", async () => {
    expect(await clamdPing("127.0.0.1", port)).toBe(true);
    expect((await clamdInstream("127.0.0.1", 1, Buffer.from("x"), 2000)).status).toBe("ERROR");
  });
});
