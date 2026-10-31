# PrintShare Bridge for Windows

PrintShare Bridge runs on the Windows PC that a USB printer — primarily the **HP LaserJet MFP M1005** — is plugged into.
It receives print jobs from the PrintShare server and prints them **through the printer's installed Windows driver**.

```
Phone (Safari/Chrome) ──HTTPS──▶ PrintShare server ◀──HTTPS + WebSocket (outbound only)── PrintShare Bridge ──Windows spooler──▶ HP driver ──USB──▶ M1005
```

## Requirements

- Windows 10 or 11 (x64).
- The printer's **Windows driver installed** and a Windows test page printing successfully
  (Settings → Bluetooth & devices → Printers & scanners → *HP LaserJet M1005* → Print a test page).
- Outbound HTTPS access to your PrintShare server. No inbound ports are opened.

The release build is self-contained: the target PC does **not** need .NET installed.

## Install and pair

1. Unzip `PrintShareBridge-win-x64.zip` to a permanent folder, e.g. `C:\Program Files\PrintShare Bridge` or `%LOCALAPPDATA%\PrintShare\Bridge\app`.
2. Run `PrintShareBridge.exe`. The pairing window opens.
3. In the PrintShare web dashboard open **Printers → Connect computer → Generate pairing code**.
4. Enter the server address (e.g. `https://print.example.com`) and the 8-character code, then **Pair this computer**.
   The HP M1005 is shared automatically if its driver is installed; otherwise tick the printer in the bridge window.
5. Answer the **Start with Windows** prompt. You can change it later from the tray menu.
6. Back in the dashboard, **Register printer**, then **Test print**.

## Tray menu

| Item | What it does |
|---|---|
| Status line | Connected / Paused / Offline (retrying) / Disconnected |
| Open PrintShare Bridge | Status window: shared printers, virtual-printer folder, live activity |
| Pause / Resume printing | Paused bridges accept no new jobs; a job already printing finishes |
| Start with Windows | Adds/removes `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\PrintShareBridge` |
| Exit | Stops the bridge (warns if a job is printing; it is re-checked on next start) |

## Command line

```
PrintShareBridge.exe                                  tray app
PrintShareBridge.exe --minimized                      tray app, window hidden (used by Start with Windows)
PrintShareBridge.exe --headless                       no UI, for unattended PCs (logs only)
PrintShareBridge.exe --list-printers                  show installed printers and their state
PrintShareBridge.exe --pair https://print.example.com ABCD-EFGH [--share "HP LaserJet M1005"] [--output-dir C:\out]
```

`--output-dir` sets the folder for virtual printers such as *Microsoft Print to PDF* that normally ask for a file name;
it lets you test the whole pipeline without hardware.

**Background service.** Microsoft does not support GDI printing (`System.Drawing.Printing`) from Windows services, so the
bridge is a per-user background app rather than a service. For a PC that must print without anyone signed in, use Task
Scheduler: *Create Task → Run whether user is logged on or not → Trigger: At startup → Action: `PrintShareBridge.exe --headless`*,
running as the account that has the HP driver installed. Verify this configuration on your hardware (see
`docs/HARDWARE_VERIFICATION.md`).

## How a job is printed

1. Job arrives (WebSocket push, or the 15-second poll as a fallback). Only printers the bridge reports as *Ready* are offered jobs.
2. The PDF is downloaded with a 10-minute token bound to this bridge, job and attempt, and its **SHA-256 is verified**.
3. Pages are rendered with PDFium at 300 dpi (Draft) or 600 dpi (Normal) and drawn into a GDI+ `PrintDocument` on the
   selected printer, so the HP driver produces the printer's own language. Copies are made by the driver when it supports them,
   otherwise by repeating pages.
4. The Windows queue is watched (`EnumJobs`). The job is reported **Completed only after the spooler confirms it**:
   `JOB_STATUS_PRINTED`, `JOB_STATUS_COMPLETE`, or the job leaving the queue cleanly after spooling finished.
   Paper-out/offline/error states are shown live in the dashboard and printing resumes when cleared.
5. Cancelling in the dashboard deletes the job from the Windows queue.

### No duplicate prints

Every attempt is written to `%LOCALAPPDATA%\PrintShare\Bridge\journal.json` **before** any data is sent to Windows.
If the bridge crashes or the PC restarts mid-job, the attempt is never spooled again: the bridge resumes watching the
original spooler job, or — if it can no longer confirm the outcome — reports `OUTCOME_UNKNOWN` so the user checks the
printer before pressing **Retry** (which creates a new attempt).

## Security

- Credentials: a per-bridge secret issued once at pairing, stored encrypted with **Windows DPAPI** (current user).
  Revoking the bridge in the dashboard invalidates it immediately.
- HTTPS is mandatory (plain HTTP only for `localhost` development). Certificates are validated by Windows.
- Downloads are refused unless they are relative to the paired server; size and SHA-256 must match.
- Runs as the signed-in user (`asInvoker`), never elevated.

## Files

| Path | Contents |
|---|---|
| `%LOCALAPPDATA%\PrintShare\Bridge\settings.json` | Server, shared printers, pause state |
| `%LOCALAPPDATA%\PrintShare\Bridge\credentials.bin` | DPAPI-encrypted bridge credential |
| `%LOCALAPPDATA%\PrintShare\Bridge\journal.json` | Per-attempt job journal (duplicate protection) |
| `%LOCALAPPDATA%\PrintShare\Bridge\logs\` | Daily logs, 14 days |

## Build from source

```powershell
dotnet test PrintShare.Bridge.sln     # 54 unit tests
./publish.ps1                         # self-contained single-file build -> artifacts/ and web/public/downloads/
```
