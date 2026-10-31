# Hardware verification — HP LaserJet MFP M1005 + iPhone

Everything that can be verified without the printer has been: the API (integration tests on PostgreSQL), the bridge
logic (unit tests), and a full end-to-end run on Windows 10 through the real spooler with the *Microsoft Print to PDF*
driver (including cancel and a crash mid-print). **What remains depends on the physical printer and a real iPhone.**
Until every box in section B passes, keep `verification: "PENDING"` for `HP_LJ_M1005` in
`web/src/lib/printing/models.ts`; switch it to `"VERIFIED"` afterwards (the UI then shows *Hardware test: Verified*).

Record results in the table at the end (date, Windows version, driver version, bridge version, notes).

## A. Prepare the Windows PC

1. Install the HP LaserJet M1005 driver (HP full package or Windows Update). Connect USB, power on.
2. Windows *Settings → Printers & scanners → HP LaserJet M1005 → Printer properties → Print Test Page* — **must print**.
3. Note the **queue name**, **driver name** and **port** (`USB001` expected):
   `PrintShareBridge.exe --list-printers`
   - [ ] Driver name contains `M1005` (the app's model match uses this) — if not, add the actual name to
     `driverPattern` in `web/src/lib/printing/models.ts`.
   - [ ] Port begins with `USB` (or `DOT4`).
4. Run `PrintShareBridge.exe`, pair it, confirm the M1005 is ticked under *Printers to share*.

## B. Acceptance checklist

| # | Step | Expected |
|---|---|---|
| B1 | Dashboard → Printers: register the M1005 | Card shows *Ready*, *USB (USB001)*, *Driver: Installed*, chips **Black & white**, **Single-sided**, A4/A5/Letter/Legal |
| B2 | **Test print** | Test page prints; grid lines are 10 mm apart (measure); corner marks ≈ 5 mm from edges; job → *Completed* with confirmation in the activity log |
| B3 | **Primary acceptance test**: on an **iPhone (Safari)** over HTTPS, sign in, upload a multi-page PDF, open it, choose the M1005, 1 copy, A4, Portrait, Fit, **Print** | Pages print on the M1005 attached to the Windows PC. iPhone shows Queued → Processing → Printing → **Completed** live, without refresh |
| B4 | iPhone: upload a photo (Camera roll) and a `.txt` | Both convert and print; photo rotated correctly |
| B5 | Page range `2-3`, 2 copies | Exactly pages 2,3,2,3 (collated) — 4 sheets |
| B6 | Landscape + Actual size with an A5 PDF on A4 paper | Content at 100 % (measure), centred |
| B7 | Quality *Draft* vs *Normal* | Draft visibly lighter/faster; both legible |
| B8 | Remove the paper, send a job | Job stays *Printing* with alert “Printer is out of paper” **if the M1005 driver reports it** (record yes/no). Reload paper → completes. Note: host-based drivers may not report paper-out; record what actually happens |
| B9 | Unplug USB (or switch off), send a job | Printer shows *Offline*; job stays *Queued* (“waiting for printer”); plug back in → prints. Record how long Windows takes to mark it offline/online |
| B10 | Cancel while printing a 20-page job | Job → *Cancelled*; remaining pages do not print (pages already in the printer's buffer may) |
| B11 | Pause in the tray, send a job; Resume | Nothing prints while paused; prints after resume |
| B12 | Exit the bridge mid-job (Task Manager → End task), restart | **No duplicate pages.** The job ends *Completed* (if Windows confirmed) or *Failed – OUTCOME_UNKNOWN* |
| B13 | Disconnect the PC from the internet for 2 min during idle, reconnect | Bridge shows *Offline — retrying*, reconnects by itself; dashboard shows the bridge offline then online |
| B14 | Reboot the PC with *Start with Windows* enabled | Bridge starts in the tray and reconnects without user action |
| B15 | iPhone: *Share → Add to Home Screen*, open from the icon | Opens full-screen, signed in, live updates work |
| B16 | iPhone: *System print* on a document | iOS print sheet opens; **the M1005 is not listed** (expected — it is not AirPrint) |

## C. Android OTG (optional investigation)

With an OTG adapter, connect the M1005 to an Android phone running the companion app (`android-companion/`).

- [ ] App detects the device (record VID:PID — expected HP vendor `03f0`).
- [ ] Permission prompt appears and is honoured.
- [ ] IEEE 1284 Device ID is read (record the full string, especially `CMD:`).
- [ ] Verdict is **“Direct printing from Android is not possible”** with the bridge recommendation.
- [ ] *Share report* produces the text report — attach it to the results table.

If the Device ID unexpectedly lists PCL or another page description language, record it: the classification rules live
in `android-companion/.../usb/Compatibility.kt`.

## D. Results

| Date | Windows / build | HP driver | Bridge | iPhone / iOS | Steps passed | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
