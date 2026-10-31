# PrintShare — print anything, from anywhere

Upload a PDF, photo or Office file from an iPhone, Android phone or computer and print it on a **USB printer
plugged into a Windows PC** — designed first for the **HP LaserJet MFP M1005** (USB-only, monochrome,
host-based, no Wi-Fi/AirPrint).

```
iPhone Safari / Android Chrome / desktop        PrintShare server (this repo: web/)              Windows PC
┌─────────────────────────────┐  HTTPS   ┌───────────────────────────────────────┐  outbound HTTPS  ┌──────────────────────────┐  USB  ┌─────────┐
│ PWA: upload, preview,       │ ───────▶ │ Next.js UI + API · PostgreSQL         │ ◀─────────────── │ PrintShare Bridge (.NET) │ ────▶ │ HP M1005│
│ print settings, live status │ ◀─ WS ── │ convert→PDF · queue · WebSocket push  │ ── WS push ────▶ │ HP driver + Windows spool│       └─────────┘
└─────────────────────────────┘          └───────────────────────────────────────┘                  └──────────────────────────┘
```

A browser cannot reach a USB printer (Safari on iOS has no USB access at all), and the M1005 has no PCL/PostScript
interpreter, so a phone cannot drive it directly. **PrintShare Bridge** on the Windows PC prints through HP's installed
driver and reports a job **Completed only after the Windows spooler confirms it**.

## Repository

| Path | What |
|---|---|
| [`web/`](web) | Next.js 15 (App Router, TypeScript strict, Tailwind 4, shadcn-style UI) web app **and** API, custom Node server with WebSocket, Prisma/PostgreSQL |
| [`bridge-windows/`](bridge-windows) | PrintShare Bridge — C#/.NET 8 tray app (+ headless mode) for Windows 10/11 |
| [`android-companion/`](android-companion) | Kotlin USB-OTG compatibility checker (explains that the M1005 needs the bridge; experimental PCL direct print for PCL printers) |
| [`docs/`](docs) | Architecture, setup, deployment, **[Vercel](docs/VERCEL.md)**, API, security, Android investigation, **hardware verification checklist** |
| [`deploy/`](deploy) | Docker Compose (PostgreSQL, ClamAV, Caddy HTTPS) for a production server |

## Quick start (Windows, development)

```powershell
# 1. Web app
cd web
copy .env.example .env          # set DATABASE_URL to your PostgreSQL and a long SIGNING_SECRET
npm install
npx prisma migrate deploy
npm run db:seed                 # creates the admin from ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev                     # http://localhost:3000

# 2. Bridge (on the PC with the printer; needs the .NET 8 SDK to build)
cd ..\bridge-windows
.\publish.ps1                   # self-contained PrintShareBridge.exe in artifacts\, also offered on the Printers page
```

Full instructions: [`docs/SETUP.md`](docs/SETUP.md) · production: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Deploy on Vercel

The web app is Vercel-ready: on Vercel it automatically switches to private **Vercel Blob** storage, direct
browser-to-Blob uploads, polling instead of WebSockets (bridges long-poll for jobs), and a secured maintenance cron.

1. Import this repo in Vercel and set **Root Directory = `web`**.
2. Connect a **Blob store** and a **PostgreSQL** database (pooled `DATABASE_URL` + direct `DIRECT_URL`).
3. Add `SIGNING_SECRET` and `CRON_SECRET`, then deploy — production builds apply migrations automatically.
4. Pair **PrintShare Bridge 1.1+** with your `https://…vercel.app` (or custom) domain.

Step-by-step, environment variables, limits and the first-deploy checklist: [`docs/VERCEL.md`](docs/VERCEL.md).

## What has been verified, and what still needs the real printer

| Area | Status |
|---|---|
| Web API: auth, uploads/conversion, isolation, pairing, job state machine, quotas, CSRF, revocation | **28 integration tests** against real PostgreSQL + **57 unit tests** — passing |
| Bridge logic: spooler outcome rules, journal, layout, API client, DPAPI | **54 xUnit tests** — passing |
| End-to-end on Windows 10 (this repo's dev PC): browser upload → server → **real bridge** → Windows spooler → *Microsoft Print to PDF* driver → spooler-confirmed completion; copies, page ranges, test page, cancel mid-spool, **crash mid-print with no duplicate**, retry | **Done** (virtual printer) |
| UI at iPhone size (375 px), PDF.js preview, PWA manifest/service worker | Checked in a mobile-emulated browser |
| **HP LaserJet MFP M1005 physically printing**, paper-out/offline reporting from its driver | **Pending — needs the hardware.** Follow [`docs/HARDWARE_VERIFICATION.md`](docs/HARDWARE_VERIFICATION.md) |
| **Real iPhone Safari** upload + remote print over HTTPS | **Pending — needs a phone and an HTTPS URL** (same checklist) |
| Android companion on a real phone | **Pending** — source + unit tests written, not built here (no Android SDK) |
| Office (DOCX/XLSX/PPTX) conversion | Implemented via LibreOffice; LibreOffice is not installed on the dev PC, so the "unavailable" path is what was tested |

The acceptance test — *iPhone uploads a PDF, selects the registered M1005, and it physically prints through the
USB-connected Windows PC* — is step-by-step in the hardware checklist. Until it passes, the M1005 is shown in the app
as **"Hardware test: Pending"** (`web/src/lib/printing/models.ts`).
