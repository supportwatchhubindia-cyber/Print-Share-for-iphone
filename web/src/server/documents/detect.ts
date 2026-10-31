import { FILE_TYPES, type FileExtension } from "@/lib/constants";

export type ContentCheck = { ok: true } | { ok: false; reason: string };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function isPdf(buf: Buffer) {
  // The spec allows leading bytes before the header; real-world files keep it within 1 KB.
  return buf.subarray(0, 1024).includes("%PDF-");
}

function isJpeg(buf: Buffer) {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function isPng(buf: Buffer) {
  return buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

function isOoxml(buf: Buffer, folder: "word/" | "xl/" | "ppt/") {
  return buf.subarray(0, 4).equals(ZIP_SIGNATURE) && buf.includes("[Content_Types].xml") && buf.includes(folder);
}

function isText(buf: Buffer) {
  const sample = buf.subarray(0, 64 * 1024);
  if (sample.includes(0)) return false;
  let control = 0;
  for (const byte of sample) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) control++;
  }
  return control <= sample.length * 0.02;
}

/** Validates that file bytes match the claimed extension (defends against renamed executables, etc.). */
export function validateContent(ext: FileExtension, buf: Buffer): ContentCheck {
  if (buf.length === 0) return { ok: false, reason: "The file is empty." };
  const family = FILE_TYPES[ext].family;
  const ok =
    family === "pdf"
      ? isPdf(buf)
      : family === "jpeg"
        ? isJpeg(buf)
        : family === "png"
          ? isPng(buf)
          : family === "docx"
            ? isOoxml(buf, "word/")
            : family === "xlsx"
              ? isOoxml(buf, "xl/")
              : family === "pptx"
                ? isOoxml(buf, "ppt/")
                : isText(buf);
  return ok ? { ok: true } : { ok: false, reason: `The file content does not look like a valid .${ext} file.` };
}
