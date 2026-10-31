export type PageRangeResult =
  | { ok: true; pages: number[]; normalized: string | null }
  | { ok: false; error: string };

/**
 * Parses "1-3, 5, 8-" style ranges into a sorted, de-duplicated page list.
 * Empty input or "all" selects every page (normalized = null).
 */
export function parsePageRange(input: string | null | undefined, pageCount: number): PageRangeResult {
  if (!Number.isInteger(pageCount) || pageCount < 1) return { ok: false, error: "Document has no pages." };
  const raw = (input ?? "").trim();
  if (raw === "" || raw.toLowerCase() === "all") {
    return { ok: true, pages: Array.from({ length: pageCount }, (_, i) => i + 1), normalized: null };
  }
  if (raw.length > 200) return { ok: false, error: "Page range is too long." };
  if (!/^[\d\s,\-–]+$/.test(raw)) return { ok: false, error: "Use numbers, commas and dashes, e.g. 1-3, 5." };

  const selected = new Set<number>();
  for (const part of raw.replace(/–/g, "-").split(",")) {
    const token = part.replace(/\s+/g, "");
    if (!token) continue;
    const m = /^(\d*)-(\d*)$/.exec(token);
    let start: number;
    let end: number;
    if (m) {
      if (!m[1] && !m[2]) return { ok: false, error: `"${part.trim()}" is not a valid range.` };
      start = m[1] ? Number(m[1]) : 1;
      end = m[2] ? Number(m[2]) : pageCount;
    } else if (/^\d+$/.test(token)) {
      start = end = Number(token);
    } else {
      return { ok: false, error: `"${part.trim()}" is not a valid page or range.` };
    }
    if (start < 1 || end < 1) return { ok: false, error: "Pages start at 1." };
    if (start > end) return { ok: false, error: `Range ${start}-${end} is backwards.` };
    if (end > pageCount)
      return { ok: false, error: `This document has ${pageCount} page${pageCount === 1 ? "" : "s"}.` };
    for (let p = start; p <= end; p++) selected.add(p);
  }
  if (selected.size === 0) return { ok: false, error: "Select at least one page." };
  const pages = [...selected].sort((a, b) => a - b);
  return { ok: true, pages, normalized: compressPages(pages, pageCount) };
}

/** [1,2,3,5] -> "1-3,5"; returns null when every page is selected. */
export function compressPages(pages: number[], pageCount: number): string | null {
  if (pages.length === pageCount && pages.every((p, i) => p === i + 1)) return null;
  const parts: string[] = [];
  let i = 0;
  while (i < pages.length) {
    const start = pages[i]!;
    let end = start;
    while (i + 1 < pages.length && pages[i + 1] === end + 1) end = pages[++i]!;
    parts.push(start === end ? `${start}` : `${start}-${end}`);
    i++;
  }
  return parts.join(",");
}
