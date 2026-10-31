import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PAPER_SIZE_INFO, type PaperSize } from "@/lib/constants";

const MM = 72 / 25.4;

/** A diagnostic page: identity block, 10 mm grid, margin marks and a grey ramp. */
export async function buildTestPagePdf(info: {
  printerName: string;
  modelName: string;
  bridgeName: string;
  systemName: string;
  paperSize: PaperSize;
  requestedBy: string;
}): Promise<Buffer> {
  const paper = PAPER_SIZE_INFO[info.paperSize];
  const W = paper.widthMm * MM;
  const H = paper.heightMm * MM;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([W, H]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const navy = rgb(0.04, 0.11, 0.23);
  const grey = rgb(0.6, 0.6, 0.6);

  for (let x = 10; x < paper.widthMm; x += 10) {
    page.drawLine({ start: { x: x * MM, y: 0 }, end: { x: x * MM, y: H }, thickness: 0.25, color: rgb(0.85, 0.85, 0.85) });
  }
  for (let y = 10; y < paper.heightMm; y += 10) {
    page.drawLine({ start: { x: 0, y: y * MM }, end: { x: W, y: y * MM }, thickness: 0.25, color: rgb(0.85, 0.85, 0.85) });
  }
  const corner = 15 * MM;
  for (const [cx, cy, dx, dy] of [
    [5 * MM, 5 * MM, 1, 1],
    [W - 5 * MM, 5 * MM, -1, 1],
    [5 * MM, H - 5 * MM, 1, -1],
    [W - 5 * MM, H - 5 * MM, -1, -1],
  ] as const) {
    page.drawLine({ start: { x: cx, y: cy }, end: { x: cx + dx * corner, y: cy }, thickness: 1.2, color: navy });
    page.drawLine({ start: { x: cx, y: cy }, end: { x: cx, y: cy + dy * corner }, thickness: 1.2, color: navy });
  }

  let y = H - 30 * MM;
  page.drawText("PrintShare test page", { x: 20 * MM, y, size: 24, font: bold, color: navy });
  y -= 12 * MM;
  const rows: [string, string][] = [
    ["Printer", info.printerName],
    ["Model", info.modelName],
    ["Windows queue", info.systemName],
    ["Bridge", info.bridgeName],
    ["Paper", paper.label],
    ["Requested by", info.requestedBy],
    ["Generated", new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"],
  ];
  for (const [label, value] of rows) {
    page.drawText(label, { x: 20 * MM, y, size: 10, font: bold, color: navy });
    page.drawText(value.slice(0, 80), { x: 60 * MM, y, size: 10, font: regular, color: navy });
    y -= 6 * MM;
  }

  y -= 6 * MM;
  page.drawText("Grey ramp", { x: 20 * MM, y, size: 10, font: bold, color: navy });
  y -= 14 * MM;
  for (let i = 0; i <= 10; i++) {
    const g = 1 - i / 10;
    page.drawRectangle({ x: (20 + i * 15) * MM, y, width: 14 * MM, height: 10 * MM, color: rgb(g, g, g), borderColor: grey, borderWidth: 0.3 });
    page.drawText(`${i * 10}%`, { x: (22 + i * 15) * MM, y: y - 4 * MM, size: 7, font: regular, color: navy });
  }

  y -= 16 * MM;
  for (const size of [6, 8, 10, 12, 16]) {
    page.drawText(`${size} pt  The quick brown fox jumps over the lazy dog 0123456789`, { x: 20 * MM, y, size, font: regular, color: navy });
    y -= size * 1.6 + 4;
  }

  page.drawText("Grid lines every 10 mm. Corner marks are 5 mm from the paper edge.", {
    x: 20 * MM,
    y: 15 * MM,
    size: 8,
    font: regular,
    color: grey,
  });
  pdf.setTitle("PrintShare test page");
  pdf.setProducer("PrintShare");
  return Buffer.from(await pdf.save());
}
