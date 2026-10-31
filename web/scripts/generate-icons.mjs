// Renders the PWA / favicon set from public/icons/icon.svg using sharp.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const dir = join(process.cwd(), "public", "icons");
mkdirSync(dir, { recursive: true });
const svg = readFileSync(join(dir, "icon.svg"));
const maskable = readFileSync(join(dir, "icon-maskable.svg"));

const jobs = [
  [svg, "icon-192.png", 192],
  [svg, "icon-512.png", 512],
  [maskable, "icon-maskable-512.png", 512],
  [maskable, "apple-touch-icon.png", 180],
  [svg, "favicon-32.png", 32],
];
for (const [src, name, size] of jobs) {
  await sharp(src, { density: 384 }).resize(size, size).png().toFile(join(dir, name));
  console.log(`[icons] ${name}`);
}
