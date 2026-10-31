import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizePairingCode, pairingCode, signToken, verifyToken } from "@/server/crypto";
import { checkRateLimit, resetRateLimits } from "@/server/rate-limit";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { pathForKey } from "@/server/storage";
import { sanitizeFilename } from "@/server/documents/service";
import { sessionTokenFromHeaders } from "@/server/auth/session";

describe("signed tokens", () => {
  afterEach(() => vi.useRealTimers());

  it("round-trips claims for the right purpose", () => {
    const token = signToken("doc", { d: "abc", v: "pdf" }, 60);
    expect(verifyToken(token, "doc")).toMatchObject({ d: "abc", v: "pdf", p: "doc" });
    expect(verifyToken(token, "bridge-doc")).toBeNull();
  });

  it("rejects tampering", () => {
    const token = signToken("doc", { d: "abc" }, 60);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ d: "other", p: "doc", exp: 9_999_999_999 })).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, "doc")).toBeNull();
    expect(verifyToken(`${body}.${sig}x`, "doc")).toBeNull();
    expect(verifyToken("garbage", "doc")).toBeNull();
    expect(verifyToken(null, "doc")).toBeNull();
  });

  it("expires", () => {
    vi.useFakeTimers();
    const token = signToken("doc", { d: "abc" }, 10);
    vi.advanceTimersByTime(11_000);
    expect(verifyToken(token, "doc")).toBeNull();
  });
});

describe("pairing codes", () => {
  it("are 8 unambiguous characters", () => {
    for (let i = 0; i < 50; i++) expect(pairingCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
  it("normalise user input", () => {
    expect(normalizePairingCode(" abcd efgh ")).toBe("ABCD-EFGH");
    expect(normalizePairingCode("abcd-efgh")).toBe("ABCD-EFGH");
  });
});

describe("rate limiter", () => {
  it("blocks after the limit and resets after the window", () => {
    resetRateLimits();
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(checkRateLimit("k", 3, 1000, t).allowed).toBe(true);
    const blocked = checkRateLimit("k", 3, 1000, t + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
    expect(checkRateLimit("k", 3, 1000, t + 1001).allowed).toBe(true);
  });
});

describe("password hashing", () => {
  it("uses argon2id and verifies", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct-horse-battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});

describe("storage keys", () => {
  it("refuse path traversal", () => {
    expect(() => pathForKey("../etc/passwd")).toThrow();
    expect(() => pathForKey("user/../../x")).toThrow();
    expect(() => pathForKey("/abs/path")).toThrow();
    expect(() => pathForKey("user\\doc")).toThrow();
    expect(pathForKey("user1/doc1/original.pdf")).toMatch(/original\.pdf$/);
  });
});

describe("filenames", () => {
  it("strip paths and control characters", () => {
    expect(sanitizeFilename("C:\\Users\\me\\Report.pdf")).toBe("Report.pdf");
    expect(sanitizeFilename("../../evil<script>.pdf")).toBe("evilscript.pdf");
    expect(sanitizeFilename("a\u0000b.txt")).toBe("ab.txt");
    expect(sanitizeFilename("")).toBe("document");
    expect(sanitizeFilename(`${"x".repeat(300)}.pdf`).length).toBeLessThanOrEqual(180);
  });
});

describe("session token extraction", () => {
  it("reads cookie and bearer, but ignores bridge credentials", () => {
    expect(sessionTokenFromHeaders(new Headers({ cookie: "a=1; ps_session=tok123" }))).toBe("tok123");
    expect(sessionTokenFromHeaders(new Headers({ authorization: "Bearer sessiontoken" }))).toBe("sessiontoken");
    expect(sessionTokenFromHeaders(new Headers({ authorization: "Bearer bridgeid.secret" }))).toBeNull();
  });
});
