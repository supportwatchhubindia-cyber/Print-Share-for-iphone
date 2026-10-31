# Android USB OTG investigation — HP LaserJet MFP M1005

## Question

Can an Android phone print to the HP LaserJet MFP M1005 directly over a USB OTG cable, without a computer?

## Findings

1. **USB access is possible.** Android's USB host API (`UsbManager`) lets an app open a printer-class interface and
   write to its bulk OUT endpoint after the user grants permission. The M1005 is a composite MFP (printer + scanner
   interfaces); the printer side is a standard USB Printer Class interface, so the *transport* is not the problem.

2. **The print language is the problem.** The M1005 is a **host-based** printer: it has no PCL, PostScript, PDF or
   PWG/URF raster interpreter. Each page must be rendered on the host by a driver into the printer's proprietary,
   compressed raster stream. HP provides that driver for Windows (and macOS); the PrintShare Bridge uses it.

3. **Android has no driver for it.** Android's printing framework relies on print services (e.g. Mopria, HP Smart,
   vendor plug-ins), which target network/IPP printers and PDL-capable devices. There is no Android print service that
   drives a host-based USB laser like the M1005. Re-implementing the host-based protocol in this app would mean shipping
   an unofficial, reverse-engineered printer driver with no way to validate output quality, error handling or firmware
   compatibility — not an acceptable basis for a product that must not fake successful printing.

4. **No completion signal over USB.** Even for printers Android *can* drive, a bulk write succeeding only means bytes
   were accepted into the printer's buffer — not that a page was printed.

## Conclusion

**Direct Android USB printing to the HP LaserJet MFP M1005 is not supported. A compatible desktop bridge is
required.** Android users print through the PrintShare web app (Chrome, installable PWA), and the job is printed by
PrintShare Bridge on the Windows PC the printer is attached to — the same path as iPhone.

## What was built

`android-companion/` (Kotlin, framework APIs only) turns this into a tool rather than a guess:

- Detects USB printers (printer class 7 or HP vendor 0x03F0), requests permission.
- Lists interfaces and reads the **IEEE 1284 Device ID** (`GET_DEVICE_ID` control request) — the printer's own
  statement of its command set (`CMD:`).
- Classifies: known host-based HP LaserJet models (M1005 and similar) or host-based command sets ⇒ *use the bridge*;
  **PCL 3/5** ⇒ *experimental direct print*; other PDLs (PostScript, PDF, PWG, URF, PCL XL) ⇒ *not implemented here*;
  anything unknown ⇒ *use the bridge*. It never answers "yes" without positive evidence.
- For PCL printers only: renders a PDF with `PdfRenderer` at 300 dpi, thresholds to 1-bit and sends **PCL 5 raster**
  (PackBits compression) to the bulk OUT endpoint, then reports *bytes sent* — never *printed*.
- Shares a text report, so real Device IDs can be collected and the rules refined.

## Verification still required

The app compiles against Android SDK 34 APIs but was not built or run in this environment (no Android SDK). The
device checklist is section C of [`HARDWARE_VERIFICATION.md`](HARDWARE_VERIFICATION.md). The expected outcome for the
M1005 is the "not possible — use the bridge" verdict; record the actual Device ID string observed.
