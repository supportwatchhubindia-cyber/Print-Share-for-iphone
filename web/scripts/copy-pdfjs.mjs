// Copies the PDF.js legacy build (broad Safari/iOS support) into /public so the
// browser loads it as a static ES module. Keeping PDF.js out of the bundler avoids
// worker/top-level-await quirks and lets the CSP stay at script-src 'self'.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("pdfjs-dist/package.json"));
const outDir = join(process.cwd(), "public", "pdfjs");
mkdirSync(outDir, { recursive: true });

for (const file of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
  const src = join(pkgDir, "legacy", "build", file);
  if (!existsSync(src)) {
    console.error(`[copy-pdfjs] missing ${src}`);
    process.exit(1);
  }
  copyFileSync(src, join(outDir, file));
}
console.log("[copy-pdfjs] PDF.js copied to public/pdfjs");
