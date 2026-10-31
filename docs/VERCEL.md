# Deploying to Vercel

The web app runs on Vercel in **serverless mode**. Differences from self-hosting are handled automatically when `VERCEL=1`:

| Self-hosted (`server.ts`) | On Vercel |
|---|---|
| WebSocket `/ws` push | **Polling**: browsers auto-refresh (3 s while a job is active); bridges **long-poll** `GET /api/bridge/jobs?wait=20` (pickup ≈ 1 s, tested) |
| Files on local disk | **Private Vercel Blob**; downloads use 15-min **presigned URLs** (function responses are capped at 4.5 MB) |
| Multipart upload to the API | Browser uploads **directly to Blob** (`/api/documents/blob-token`), then `/api/documents/ingest` validates, scans and converts |
| Maintenance timers | `vercel.json` cron → `/api/cron/maintenance` (Hobby: daily; Pro: set `*/10 * * * *`) + opportunistic runs after uploads |
| LibreOffice for DOCX/XLSX/PPTX | Set `GOTENBERG_URL` to a [Gotenberg](https://gotenberg.dev) instance (LibreOffice can't run on Vercel) |

## Steps

1. **Database**: create PostgreSQL (e.g. Neon, Supabase, Vercel Postgres). You need a **pooled** URL for the app and a **direct** URL for migrations.
2. **Import the GitHub repo** in Vercel → **Root Directory: `web`** (framework Next.js is detected; `vercel.json` sets the build command).
3. **Storage → Create Blob store** and connect it to the project (adds `BLOB_READ_WRITE_TOKEN`).
4. **Environment variables** (Production + Preview):

| Variable | Value |
|---|---|
| `DATABASE_URL` | pooled URL, e.g. `postgresql://…-pooler…/db?sslmode=require&pgbouncer=true` |
| `DIRECT_URL` | non-pooled URL (used only by `prisma migrate deploy` during production builds) |
| `SIGNING_SECRET` | ≥ 32 random chars |
| `CRON_SECRET` | random string (Vercel Cron sends it as a bearer token) |
| `APP_URL` | optional; defaults to the production domain |
| `GOTENBERG_URL`, `GOTENBERG_AUTH` | optional, for Office files (`user:pass` if basic auth is enabled) |
| `CLAMAV_HOST`, `MALWARE_SCAN_REQUIRED` | optional; only with a reachable, private clamd |
| `BRIDGE_DOWNLOAD_URL` | optional; where the dashboard links the Windows bridge zip |

5. **Deploy.** Production builds run `prisma migrate deploy` (via `DIRECT_URL`); preview builds skip migrations unless `MIGRATE_ON_BUILD=true`.
6. **Admin account**: from your PC, `cd web`, set `DATABASE_URL` to the direct URL plus `ADMIN_EMAIL`/`ADMIN_PASSWORD`, run `npm run db:seed`.
7. **Bridge**: pair PrintShare Bridge **1.1.0+** with `https://<your-domain>` (1.1 adds long-polling and Blob redirect downloads; 1.0 still works but only polls every 15 s).

## Verify after the first deploy (not testable without a Vercel account)

- [ ] Upload a > 5 MB PDF from an iPhone: it uploads (direct to Blob) and gets a page count.
- [ ] The PDF **preview renders** (cross-origin fetch of the presigned Blob URL). If it shows "Preview unavailable", printing still works; report the browser console error.
- [ ] Bridge log shows "long-polling", a job prints and turns **Completed**.
- [ ] Admin → System health: storage "Vercel Blob (private)", realtime "Polling mode".
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/maintenance` returns `ok`.

## Limits to know

- Rate limits are per function instance; add Vercel Firewall rules for `/api/auth/*` in production.
- Hobby cron is daily: expired documents are refused immediately but their files may stay up to ~1 day (plus opportunistic cleanup).
- Function max duration: uploads/ingest 60 s, long-poll 30 s.
