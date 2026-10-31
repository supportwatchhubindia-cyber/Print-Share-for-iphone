import { describe, expect, it } from "vitest";
import { mergeCapabilities, parseCapabilities, qualitiesForResolutions } from "@/lib/printing/capabilities";
import { HP_LJ_M1005, GENERIC_WINDOWS_PRINTER, connectionFromPort, identifyModel } from "@/lib/printing/models";
import { defaultSettings, validateSettings, type PrintSettings } from "@/lib/printing/settings";

const base: PrintSettings = {
  copies: 1,
  pageRange: null,
  paperSize: "A4",
  orientation: "PORTRAIT",
  colorMode: "MONOCHROME",
  duplex: "SIMPLEX",
  quality: "NORMAL",
  scaleMode: "FIT",
};

describe("HP LaserJet MFP M1005 profile", () => {
  const caps = HP_LJ_M1005.profile;

  it("never offers colour or duplex", () => {
    expect(caps.color).toBe(false);
    expect(caps.duplex).toBe(false);
  });

  it("cannot be widened by a driver that over-reports", () => {
    const merged = mergeCapabilities(caps, { supportsColor: true, canDuplex: true, paperSizes: ["A4", "LETTER", "B5"], resolutionsDpi: [600, 1200], maxCopies: 999 });
    expect(merged).toMatchObject({ color: false, duplex: false, paperSizes: ["A4", "LETTER"], maxCopies: 99, source: "DRIVER" });
    expect(merged.qualities).toEqual(["DRAFT", "NORMAL"]);
  });

  it("narrows to what the driver actually reports", () => {
    const merged = mergeCapabilities(caps, { supportsColor: false, canDuplex: false, paperSizes: ["A4"], resolutionsDpi: [300], maxCopies: 1 });
    expect(merged.paperSizes).toEqual(["A4"]);
    expect(merged.qualities).toEqual(["DRAFT"]);
    // The bridge repeats pages when the driver can't make copies, so the profile limit applies.
    expect(merged.maxCopies).toBe(99);
  });

  it("rejects unsupported settings with field messages", () => {
    const result = validateSettings({ ...base, colorMode: "COLOR", duplex: "LONG_EDGE", quality: "HIGH", copies: 120, pageRange: "9" }, caps, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fields).sort()).toEqual(["colorMode", "copies", "duplex", "pageRange", "quality"]);
  });

  it("accepts a normal mono job", () => {
    expect(validateSettings({ ...base, pageRange: "2-3", copies: 3 }, caps, 3)).toEqual({ ok: true, pages: [2, 3], normalizedRange: "2-3" });
  });

  it("derives defaults from capabilities", () => {
    expect(defaultSettings(caps)).toMatchObject({ paperSize: "A4", quality: "NORMAL", colorMode: "MONOCHROME", duplex: "SIMPLEX" });
  });
});

describe("model identification", () => {
  it("matches HP M1005 driver names", () => {
    expect(identifyModel("HP LaserJet M1005").key).toBe("HP_LJ_M1005");
    expect(identifyModel("HP LaserJet M1005 MFP").key).toBe("HP_LJ_M1005");
    expect(identifyModel(null, "hp laserjet m1005 (copy 1)").key).toBe("HP_LJ_M1005");
    expect(identifyModel("Microsoft Print To PDF").key).toBe(GENERIC_WINDOWS_PRINTER.key);
  });

  it("classifies Windows port names", () => {
    expect(connectionFromPort("USB001")).toBe("USB");
    expect(connectionFromPort("DOT4_001")).toBe("USB");
    expect(connectionFromPort("IP_192.168.1.20")).toBe("NETWORK");
    expect(connectionFromPort("WSD-1234")).toBe("NETWORK");
    expect(connectionFromPort("PORTPROMPT:")).toBe("VIRTUAL");
    expect(connectionFromPort("COM1:")).toBe("OTHER");
  });
});

describe("capability helpers", () => {
  it("maps resolutions to qualities", () => {
    expect(qualitiesForResolutions([300])).toEqual(["DRAFT"]);
    expect(qualitiesForResolutions([600])).toEqual(["DRAFT", "NORMAL"]);
    expect(qualitiesForResolutions([600, 1200])).toEqual(["DRAFT", "NORMAL", "HIGH"]);
  });

  it("parses stored JSON defensively", () => {
    const parsed = parseCapabilities({ color: "yes", paperSizes: ["A4", "TABLOID"], maxCopies: -3 });
    expect(parsed).toMatchObject({ color: false, paperSizes: ["A4"], maxCopies: 1, source: "MODEL_PROFILE" });
  });
});
