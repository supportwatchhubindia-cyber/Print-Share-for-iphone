# Architecture

## Goals and constraints

- Print from **any phone browser** (iPhone Safari included) to a **USB-only** printer.
- Primary printer: **HP LaserJet MFP M1005** — USB 2.0, monochrome, simplex, *host-based* (no PCL/PostScript; pages
  are rendered by HP's host driver). No Wi-Fi, no AirPrint.
- Never claim a page printed without confirmation from the printing system; never print a job twice by accident.
- No inbound ports on the printer's network.

Consequences:
1. A browser can't reach USB printers (iOS has no WebUSB; desktop WebUSB can't drive a host-based printer either).
2. A phone can't drive the M1005 over OTG (no driver that produces its host-based stream on Android).
3. ⇒ A small **bridge** on the Windows PC the printer is attached to prints through the **installed HP driver** via the
   Windows spooler. Everything else talks to a central server.

## Components

| Component | Tech | Responsibility |
|---|---|---|
| `web/` UI | Next.js 15 App Router, React 19, Tailwind 4, Radix primitives (shadcn-style), Lucide, SWR, PDF.js 4 (legacy build, served from `/public`) | Landing, auth, dashboard, upload, preview + print settings, printers, jobs, settings, admin, PWA |
| `web/` API | Next.js route handlers (`src/app/api/**`) + domain services (`src/server/**`) | Auth, documents, conversion, printers, jobs, bridge protocol, admin, audit, rate limits |
| `web/server.ts` | Node HTTP server hosting Next + `ws` WebSocket at `/ws` | Realtime fan-out, maintenance timers, client IP/proto injection |
| PostgreSQL + Prisma 6 | `prisma/schema.prisma`, SQL migrations | Users, sessions, bridges, printers, documents, jobs, job events, subscriptions, usage, audit log |
| `bridge-windows/` | .NET 8 WinForms tray app + Core library | Pairing, heartbeat, job pull, download+verify, PDFium render, GDI+ print via driver, spooler monitoring, journal |
| `android-companion/` | Kotlin, framework APIs only | USB OTG probe, IEEE 1284 ID, compatibility verdict, experimental PCL raster |

Server code never ships to the browser: client components only import `src/lib/**` (shared types/rules) and call the API
(enforced by an ESLint `no-restricted-imports` rule).

## Data model (Prisma)

`User` · `DeviceSession` (hashed session tokens, device label, sliding expiry) · `DesktopBridge` (hashed secret,
status, last seen, detected printers JSON) · `BridgePairingCode` (hashed, 10-min, single use) · `Printer` (model key,
Windows queue name, port, connection, state, driver status, effective capabilities JSON, soft delete) · `Document`
(original + print-ready PDF keys, SHA-256, page count, scan status, expiry) · `PrintJob` (settings, attempt, spooler job id,
cancel request, timestamps, errors) · `PrintJobEvent` (timeline) · `Subscription` · `UsageRecord` (one per completed job,
unique) · `AuditLog`. Every user-owned query filters by `userId`.

## Document pipeline

Upload (multipart, size-checked before buffering) → extension allow-list → **magic-byte validation** (PDF header, JPEG/PNG
signatures, OOXML zip with `word/`/`xl/`/`ppt/`, text heuristics) → store original (random key, outside web root) →
**malware scan** (ClamAV `INSTREAM`; `SKIPPED` if not configured, or reject when `MALWARE_SCAN_REQUIRED`) →
**convert to a print-ready PDF**: PDF as-is (validated, encrypted rejected) · JPEG/PNG via Sharp (EXIF-rotate, flatten,
fit to A4 with orientation) · TXT via pdf-lib (Courier, wrapped, paginated) · DOCX/XLSX/PPTX via LibreOffice headless
(isolated profile, 2 concurrent, timeout). Page count + SHA-256 stored. Files expire after `DOCUMENT_TTL_HOURS`.

## Print job lifecycle

```
UPLOADED ─▶ QUEUED ─▶ PROCESSING ─▶ PRINTING ─▶ COMPLETED
   │          │  ▲        │   │         │
   │          │  └────────┘   │         ├──▶ FAILED ──retry──▶ QUEUED (attempt+1)
   └──────────┴───────────────┴─────────┴──▶ CANCELLED ─retry─▶ QUEUED
```

- **QUEUED → PROCESSING** only via an atomic, status-guarded claim by the bridge that owns the printer, and only for
  printers the bridge reports as *Ready*.
- **PROCESSING → QUEUED** is a bridge "release" before anything reached the spooler (e.g. printer went offline).
- **→ COMPLETED** requires a spooler confirmation (`SPOOLER_PRINTED_FLAG`, `SPOOLER_COMPLETE_FLAG` or
  `SPOOLER_QUEUE_DRAINED`) and the spooler job id; usage is metered once (unique `UsageRecord.printJobId`).
- Every report carries the **attempt** number; stale attempts are rejected (409), terminal reports are idempotent.
- Cancel: immediate for UPLOADED/QUEUED; for PROCESSING/PRINTING a cancel request is pushed to the bridge, which deletes
  the Windows job and reports CANCELLED.

Settings are validated twice with the same shared code (`src/lib/printing/settings.ts`): in the browser for instant
feedback and on the server against the printer's **effective capabilities** = *model profile ∩ driver report*. The M1005
profile is mono + simplex, so colour/duplex can never be offered or accepted even if a driver over-reports.

## Bridge protocol

| Call | Purpose |
|---|---|
| `POST /api/bridge/register` | One-time pairing code → `bridgeId` + secret (shown once; stored DPAPI-encrypted) |
| `POST /api/bridge/heartbeat` (20 s) | Bridge state + shared printers (state, driver, port, capabilities). Response: cancel requests, registered printer ids |
| `GET /api/bridge/jobs?ready=…` (15 s, or immediately on push) | In-flight jobs (crash recovery) + newly claimed jobs |
| `GET /api/bridge/jobs/:id/document?token=…` | PDF download: bridge credential **and** 10-min HMAC token bound to job+bridge+attempt |
| `POST /api/bridge/jobs/:id/status` | PROCESSING/PRINTING progress, printer alerts, final status with confirmation |
| `wss://…/ws` | Push: `job.available`, `job.cancel`, `printers.refresh`, `bridge.revoked` |

Authentication: `Authorization: Bearer <bridgeId>.<secret>`; server stores SHA-256 of the secret and compares in constant
time. Bridges are marked offline after 75 s without a heartbeat.

### Completion and duplicate protection (bridge)

1. Journal entry written **before** each stage (`Received → Downloaded → Spooling → Spooled → Finished`).
2. The PDF is rendered (PDFium, 300/600 dpi) into a GDI+ `PrintDocument` on the HP driver with a unique document title.
3. The queue is polled (`EnumJobs`) to learn the spooler job id and follow its flags.
4. `JobOutcomeTracker` decides: printed/complete flags or a clean drain after spooling ⇒ COMPLETED; deleted ⇒ CANCELLED
   (we asked) or FAILED; disappeared while in error, or spooling interrupted ⇒ FAILED `OUTCOME_UNKNOWN` (user checks
   output before retrying). Paper-out/offline/user-intervention are live alerts, not failures.
5. After a crash, an attempt that reached `Spooling` is **never spooled again**; the bridge only resumes monitoring.

Verified on Windows 10 with the *Microsoft Print to PDF* driver, including killing the bridge mid-spool.

## Realtime

Handlers publish small events with `pg_notify('printshare_events', …)`. `server.ts` holds one `LISTEN` connection and
fans out to sockets by user or bridge. This works across multiple server instances without Redis. Events only say *what*
changed; clients refetch with SWR, so a missed event is healed on the next revalidation or reconnect.

## Security summary

See [`SECURITY.md`](SECURITY.md). Highlights: argon2id passwords; hashed, httpOnly SameSite=Lax session cookies with
sliding expiry; Origin-checked mutations (CSRF); per-IP/per-user rate limits; ownership checks on every query;
signed short-lived document URLs; strict CSP and security headers; audit log; DPAPI-protected bridge credential;
HTTPS-only bridge; no inbound ports.

## Scaling notes

- Stateless web tier except: in-memory rate limiter (per instance — add limits at the proxy too) and local file
  storage (`STORAGE_DIR` — use a shared volume, or swap `src/server/storage.ts` for object storage).
- Realtime and job claims are safe across instances (Postgres NOTIFY, status-guarded updates).
- Maintenance timers are idempotent; running them on every instance is safe.
