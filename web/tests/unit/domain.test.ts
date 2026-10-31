import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as C from "@/lib/constants";
import { JOB_TRANSITIONS, canTransition } from "@/lib/printing/transitions";
import { describeUserAgent, isIOSDevice } from "@/lib/device";
import { formatBytes, formatJobNumber } from "@/lib/format";

function prismaEnum(name: string): string[] {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const block = new RegExp(`enum ${name} \\{([^}]+)\\}`).exec(schema);
  if (!block) throw new Error(`enum ${name} not found`);
  return block[1]!.split(/\s+/).filter(Boolean);
}

describe("shared enums mirror the Prisma schema", () => {
  it.each([
    ["PrintJobStatus", C.PRINT_JOB_STATUSES],
    ["PaperSize", C.PAPER_SIZES],
    ["Orientation", C.ORIENTATIONS],
    ["ColorMode", C.COLOR_MODES],
    ["DuplexMode", C.DUPLEX_MODES],
    ["PrintQuality", C.PRINT_QUALITIES],
    ["ScaleMode", C.SCALE_MODES],
    ["PrinterState", C.PRINTER_STATES],
    ["PrinterConnection", C.PRINTER_CONNECTIONS],
    ["DriverStatus", C.DRIVER_STATUSES],
    ["BridgeStatus", C.BRIDGE_STATUSES],
    ["DocumentStatus", C.DOCUMENT_STATUSES],
    ["ScanStatus", C.SCAN_STATUSES],
    ["SubscriptionPlan", C.SUBSCRIPTION_PLANS],
    ["Role", C.ROLES],
  ] as const)("%s", (name, values) => {
    expect([...values]).toEqual(prismaEnum(name));
  });
});

describe("job state machine", () => {
  it("only reaches COMPLETED from the bridge-side states", () => {
    const into = Object.entries(JOB_TRANSITIONS).filter(([, to]) => to.includes("COMPLETED")).map(([from]) => from);
    expect(into.sort()).toEqual(["PRINTING", "PROCESSING"]);
  });
  it("treats COMPLETED as terminal and allows retrying failures", () => {
    expect(JOB_TRANSITIONS.COMPLETED).toEqual([]);
    expect(canTransition("FAILED", "QUEUED")).toBe(true);
    expect(canTransition("CANCELLED", "QUEUED")).toBe(true);
    expect(canTransition("QUEUED", "PRINTING")).toBe(false);
    expect(canTransition("PRINTING", "QUEUED")).toBe(false);
  });
});

describe("upload formats", () => {
  it("cover exactly the required types", () => {
    expect(C.ACCEPTED_EXTENSIONS.sort()).toEqual(["docx", "jpeg", "jpg", "pdf", "png", "pptx", "txt", "xlsx"]);
    expect(C.ACCEPT_ATTRIBUTE).toContain("application/pdf");
    expect(C.extensionOf("A.Report.PDF")).toBe("pdf");
  });
});

describe("device labels", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  it("describes common user agents", () => {
    expect(describeUserAgent(iphone)).toBe("iPhone · Safari");
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36 Edg/126.0")).toBe("Windows · Edge");
    expect(describeUserAgent("PrintShare-Bridge/1.0")).toBe("Windows Bridge");
  });
  it("detects iPadOS desktop-mode Safari", () => {
    expect(isIOSDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(isIOSDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(isIOSDevice(iphone)).toBe(true);
  });
});

describe("formatting", () => {
  it("formats sizes and job numbers", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1048576)).toBe("25 MB");
    expect(formatJobNumber(42)).toBe("#00042");
  });
});
