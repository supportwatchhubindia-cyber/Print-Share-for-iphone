# Local setup (Windows)

This sets up the web app, database and bridge on one Windows PC — the typical arrangement for a home or small office
where the HP LaserJet M1005 is plugged into that PC.

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20.11+ (22 LTS recommended) | `node --version` |
| PostgreSQL | 14+ (tested with 18) | Local install or a managed database |
| .NET SDK | 8.0 | Only to build the bridge. End users get a self-contained `.exe` |
| HP LaserJet M1005 driver | latest from HP / Windows Update | Print a Windows test page before using PrintShare |
| LibreOffice (optional) | 7.x+ | Enables DOCX/XLSX/PPTX uploads. Without it they are rejected with a clear message |
| ClamAV (optional) | clamd 1.x | Malware scanning of uploads |

## 2. Database

```sql
-- in psql as a superuser
CREATE USER printshare WITH PASSWORD 'choose-a-strong-password';
CREATE DATABASE printshare OWNER printshare;
CREATE DATABASE printshare_test OWNER printshare;   -- only for integration tests
```

## 3. Web app

```powershell
cd web
copy .env.example .env
```

Edit `.env`:

```ini
DATABASE_URL="postgresql://printshare:PASSWORD@localhost:5432/printshare?schema=public"
APP_URL="http://localhost:3000"
SIGNING_SECRET="<output of: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\">"
ADMIN_EMAIL="you@example.com"
ADMIN_PASSWORD="a-strong-password"
# LIBREOFFICE_PATH="C:\Program Files\LibreOffice\program\soffice.exe"   # auto-detected if installed there
```

```powershell
npm install                 # also generates the Prisma client and copies PDF.js into public/pdfjs
npx prisma migrate deploy   # creates tables
npm run db:seed             # creates/promotes the admin account
npm run dev                 # http://localhost:3000 (Next.js + WebSocket server)
```

Open http://localhost:3000, create an account (or sign in as the admin).

## 4. Bridge

```powershell
cd bridge-windows
dotnet test PrintShare.Bridge.sln     # optional
.\publish.ps1                          # -> artifacts\PrintShareBridge-win-x64\PrintShareBridge.exe
```

`publish.ps1` also copies the zip to `web/public/downloads/`, so **Printers → Connect computer** offers it for download.

Run `PrintShareBridge.exe`, then in the web app: **Printers → Connect computer → Generate pairing code**, enter
`http://localhost:3000` and the code in the bridge. (The bridge accepts plain `http://` only for `localhost`.)
Then **Register printer → Test print**.

## 5. Testing from an iPhone

The phone must reach the server over **HTTPS** for the installable app (service worker) and for a production-like test.
Options:

- **Quick LAN test (no install prompt):** set `HOST=0.0.0.0`, find the PC's IP (`ipconfig`), allow Node through Windows
  Firewall for *Private* networks, and open `http://<PC-IP>:3000` on the iPhone (same Wi-Fi). Upload, preview and remote
  printing work; *Add to Home Screen* works but runs without the offline cache.
- **HTTPS tunnel (recommended):** e.g. Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:3000`) or
  Tailscale Funnel. Set `APP_URL` to the public HTTPS URL and `TRUST_PROXY=true`, restart, and pair the bridge with that
  URL (or keep the bridge on `http://localhost:3000` when it runs on the same PC).

Then follow [`HARDWARE_VERIFICATION.md`](HARDWARE_VERIFICATION.md).

## 6. Tests

```powershell
cd web
npm test                    # unit tests (no database needed)
$env:TEST_DATABASE_URL="postgresql://printshare:PASSWORD@localhost:5432/printshare_test?schema=public"
npm run test:integration    # applies migrations to the *test* DB, then truncates its tables per run
npm run typecheck; npm run lint; npm run build

cd ..\bridge-windows
dotnet test PrintShare.Bridge.sln
```

The integration suite refuses to run against a database whose name does not contain `test`.

## 7. Testing without the printer

Share **Microsoft Print to PDF** in the bridge and set an output folder (bridge window → *Virtual printer output*, or
`PrintShareBridge.exe --output-dir C:\PrintShareOut`). Jobs then go through the real Windows spooler and driver and land
as PDF files, which lets you exercise everything except the HP driver and the physical printer.

## Troubleshooting

| Symptom | Check |
|---|---|
| Bridge "Offline — retrying" | Server URL reachable from the PC? Proxy/firewall allows outbound HTTPS? See `%LOCALAPPDATA%\PrintShare\Bridge\logs` |
| Printer shows **Offline** | USB cable/power; Windows *Printers & scanners* shows it offline too? Untick *Use Printer Offline* in the Windows queue |
| Jobs stay **Queued** | Bridge paused? Printer registered and *Ready*? Bridge running as the same Windows user that has the HP driver? |
| `OUTCOME_UNKNOWN` | The bridge could not confirm the job (it was interrupted or the job vanished while the printer reported an error). Check the paper output, then **Retry** if needed |
| DOCX rejected | Install LibreOffice or set `LIBREOFFICE_PATH`; the admin **System health** tab shows whether it was found |
| `prisma migrate` can't connect | `DATABASE_URL` host/port/password; PostgreSQL service running |
