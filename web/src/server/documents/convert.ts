import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { env } from "../env";

export class ConversionError extends Error {
  constructor(
    public readonly code: "INVALID_PDF" | "ENCRYPTED_PDF" | "INVALID_IMAGE" | "CONVERSION_UNAVAILABLE" | "CONVERSION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "ConversionError";
  }
}

const MM = 72 / 25.4;
const A4 = { w: 210 * MM, h: 297 * MM };

/** Loads a PDF to validate it and count pages. */
export async function inspectPdf(buf: Buffer | Uint8Array): Promise<{ pageCount: number }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new ConversionError("INVALID_PDF", "This PDF could not be read. It may be damaged.");
  }
  if (doc.isEncrypted) {
    throw new ConversionError("ENCRYPTED_PDF", "Password-protected PDFs can't be printed. Remove the password and upload again.");
  }
  // pdf-lib parses lazily: a broken page tree only fails here.
  let pageCount: number;
  try {
    pageCount = doc.getPageCount();
  } catch {
    throw new ConversionError("INVALID_PDF", "This PDF could not be read. It may be damaged.");
  }
  if (pageCount < 1) throw new ConversionError("INVALID_PDF", "This PDF has no pages.");
  return { pageCount };
}

/** JPEG/PNG -> single-page A4 PDF (orientation follows the image), EXIF-rotated, fitted inside 10 mm margins. */
export async function imageToPdf(buf: Buffer): Promise<Buffer> {
  let out: { data: Buffer; info: sharp.OutputInfo };
  let isPng = false;
  try {
    const meta = await sharp(buf, { limitInputPixels: 150_000_000 }).metadata();
    isPng = meta.format === "png";
    const pipeline = sharp(buf, { limitInputPixels: 150_000_000 })
      .rotate()
      .resize({ width: 7000, height: 7000, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" });
    out = await (isPng ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 90, mozjpeg: true })).toBuffer({
      resolveWithObject: true,
    });
  } catch {
    throw new ConversionError("INVALID_IMAGE", "This image could not be read. It may be damaged or in an unsupported format.");
  }

  const pdf = await PDFDocument.create();
  const image = isPng ? await pdf.embedPng(out.data) : await pdf.embedJpg(out.data);
  const landscape = out.info.width > out.info.height;
  const pageW = landscape ? A4.h : A4.w;
  const pageH = landscape ? A4.w : A4.h;
  const margin = 10 * MM;
  const scale = Math.min((pageW - 2 * margin) / image.width, (pageH - 2 * margin) / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const page = pdf.addPage([pageW, pageH]);
  page.drawImage(image, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
  pdf.setTitle("Image");
  pdf.setProducer("PrintShare");
  return Buffer.from(await pdf.save());
}

/** Plain text -> A4 PDF in Courier 10pt with wrapping. Characters outside WinAnsi are replaced with "?". */
export async function textToPdf(buf: Buffer): Promise<Buffer> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("latin1").decode(buf);
  }
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);
  const supported = new Set(font.getCharacterSet());
  const fontSize = 10;
  const lineHeight = 12;
  const margin = 15 * MM;
  const charWidth = font.widthOfTextAtSize("M", fontSize);
  const maxChars = Math.floor((A4.w - 2 * margin) / charWidth);
  const linesPerPage = Math.floor((A4.h - 2 * margin) / lineHeight);

  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const clean = Array.from(rawLine, (ch) => (supported.has(ch.codePointAt(0)!) ? ch : "?")).join("");
    if (clean.length === 0) {
      lines.push("");
      continue;
    }
    for (let i = 0; i < clean.length; i += maxChars) lines.push(clean.slice(i, i + maxChars));
  }
  if (lines.length === 0) lines.push("");

  for (let i = 0; i < lines.length; i += linesPerPage) {
    const page = pdf.addPage([A4.w, A4.h]);
    lines.slice(i, i + linesPerPage).forEach((line, idx) => {
      if (line) page.drawText(line, { x: margin, y: A4.h - margin - fontSize - idx * lineHeight, size: fontSize, font, color: rgb(0, 0, 0) });
    });
  }
  pdf.setProducer("PrintShare");
  return Buffer.from(await pdf.save());
}

const LIBREOFFICE_CANDIDATES = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.com",
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
  "/usr/lib/libreoffice/program/soffice",
  "/opt/libreoffice/program/soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
];

export function findLibreOffice(): string | null {
  const configured = env().LIBREOFFICE_PATH;
  if (configured) {
    // soffice.exe detaches on Windows; the .com console shim waits for the conversion to finish.
    const com = configured.replace(/soffice\.exe$/i, "soffice.com");
    if (com !== configured && existsSync(com)) return com;
    return existsSync(configured) ? configured : null;
  }
  return LIBREOFFICE_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

// LibreOffice is memory hungry; never run more than two conversions at once.
let running = 0;
const waiters: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => waiters.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiters.shift()?.();
  }
}

/** DOCX/XLSX/PPTX -> PDF via LibreOffice headless with an isolated profile and a hard timeout. */
export async function officeToPdf(buf: Buffer, ext: "docx" | "xlsx" | "pptx"): Promise<Buffer> {
  const soffice = findLibreOffice();
  if (!soffice) {
    throw new ConversionError(
      "CONVERSION_UNAVAILABLE",
      "Office files need LibreOffice on the server, which is not installed. Export the file as PDF and upload that instead.",
    );
  }
  return withSlot(async () => {
    const work = await mkdtemp(join(tmpdir(), "printshare-convert-"));
    try {
      const input = join(work, `input.${ext}`);
      await writeFile(input, buf);
      const profile = pathToFileURL(join(work, "profile")).href;
      const args = [
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--nodefault",
        "--nofirststartwizard",
        `-env:UserInstallation=${profile}`,
        "--convert-to",
        "pdf",
        "--outdir",
        work,
        input,
      ];
      await new Promise<void>((resolve, reject) => {
        const child = spawn(soffice, args, { cwd: dirname(soffice), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (d) => (stderr += d.toString()));
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new ConversionError("CONVERSION_FAILED", "Converting this document took too long."));
        }, env().LIBREOFFICE_TIMEOUT_MS);
        child.on("error", (err) => {
          clearTimeout(timer);
          reject(new ConversionError("CONVERSION_FAILED", `Could not start LibreOffice: ${err.message}`));
        });
        child.on("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new ConversionError("CONVERSION_FAILED", `LibreOffice exited with code ${code}. ${stderr.slice(0, 300)}`));
        });
      });
      const output = join(work, "input.pdf");
      if (!existsSync(output)) throw new ConversionError("CONVERSION_FAILED", "LibreOffice did not produce a PDF for this file.");
      return await readFile(output);
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}
