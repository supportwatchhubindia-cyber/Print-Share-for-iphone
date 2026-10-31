import { describe, expect, it } from "vitest";
import { compressPages, parsePageRange } from "@/lib/printing/page-range";

describe("parsePageRange", () => {
  it("selects all pages for empty input or 'all'", () => {
    expect(parsePageRange("", 3)).toEqual({ ok: true, pages: [1, 2, 3], normalized: null });
    expect(parsePageRange("ALL", 2)).toEqual({ ok: true, pages: [1, 2], normalized: null });
    expect(parsePageRange(null, 1)).toEqual({ ok: true, pages: [1], normalized: null });
  });

  it("parses mixed ranges, de-duplicates and sorts", () => {
    expect(parsePageRange("5, 1-3, 2", 10)).toEqual({ ok: true, pages: [1, 2, 3, 5], normalized: "1-3,5" });
  });

  it("supports open-ended ranges and en dashes", () => {
    expect(parsePageRange("8-", 10)).toMatchObject({ ok: true, pages: [8, 9, 10] });
    expect(parsePageRange("-2", 10)).toMatchObject({ ok: true, pages: [1, 2] });
    expect(parsePageRange("3–4", 10)).toMatchObject({ ok: true, pages: [3, 4] });
  });

  it("returns null normalization when the range covers every page", () => {
    expect(parsePageRange("1-4", 4)).toMatchObject({ ok: true, normalized: null });
  });

  it("rejects out-of-range, reversed and malformed input", () => {
    expect(parsePageRange("0", 5).ok).toBe(false);
    expect(parsePageRange("4-6", 5)).toEqual({ ok: false, error: "This document has 5 pages." });
    expect(parsePageRange("5-2", 9).ok).toBe(false);
    expect(parsePageRange("1;2", 9).ok).toBe(false);
    expect(parsePageRange("a-b", 9).ok).toBe(false);
    expect(parsePageRange("-", 9).ok).toBe(false);
    expect(parsePageRange(",,", 9).ok).toBe(false);
    expect(parsePageRange("1", 0).ok).toBe(false);
  });
});

describe("compressPages", () => {
  it("compresses runs", () => {
    expect(compressPages([1, 2, 3, 7, 9, 10], 12)).toBe("1-3,7,9-10");
    expect(compressPages([1, 2], 2)).toBeNull();
  });
});
