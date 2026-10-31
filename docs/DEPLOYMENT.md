# Production deployment

The PrintShare server must be reachable over **HTTPS** by phones and by the Windows bridge. Common layouts:

| Layout | When |
|---|---|
| **Vercel** (serverless) — see [`VERCEL.md`](VERCEL.md) | Easiest hosting: managed HTTPS, Blob storage, no server to run. Uses polling instead of WebSockets |
| **A. Cloud server** (VPS) running the web app; the bridge on the office/home PC connects out to it | Several sites or users, always-on, instant WebSocket updates |
| **B. Same Windows PC** runs the web app *and* the bridge, published through an HTTPS tunnel | One printer at home/small office, no server to rent |

The bridge only makes **outbound** connections in every case.

## A. Cloud server with Docker Compose

Files: `deploy/docker-compose.yml`, `deploy/Caddyfile`, `web/Dockerfile`.

```bash
git clone <repo> printshare && cd printshare/deploy
cp .env.example .env        # DOMAIN, POSTGRES_PASSWORD, SIGNING_SECRET, admin
docker compose up -d --build
docker compose exec web node dist/seed.cjs     # creates/promotes the admin from ADMIN_EMAIL / ADMIN_PASSWORD
```

- Point the domain's DNS `A/AAAA` records at the server first; Caddy obtains and renews the TLS certificate.
- The image runs `prisma migrate deploy` on start, includes LibreOffice for Office conversion, and uses ClamAV
  (`MALWARE_SCAN_REQUIRED=true` rejects uploads if clamd is down — the first ClamAV start downloads signatures and takes a few minutes).
- Persistent volumes: `db_data` (PostgreSQL), `storage` (uploaded/converted files, short-lived), `caddy_data` (certificates).
- Health: `GET /api/health` (used by the container healthcheck); admin **System health** tab shows DB, storage, LibreOffice, ClamAV, realtime and stalled jobs.

> This Compose stack was written for this project but **not built in the development environment** (no Docker there).
> Run `docker compose build` once and review the result before going live.

### Without Docker

Node 22, PostgreSQL 14+, optionally LibreOffice and clamd:

```bash
cd web
npm ci
npx prisma migrate deploy
npm run build                     # next build + bundles server.ts -> dist/server.cjs
NODE_ENV=production node dist/server.cjs        # or: npm start
```

Put a TLS reverse proxy in front (Caddy/nginx) that forwards WebSockets on `/ws`, and set `TRUST_PROXY=true`.
Run it under systemd/pm2 with automatic restart.

## B. Everything on the Windows PC

1. Install PostgreSQL and Node 22 on the PC; follow [`SETUP.md`](SETUP.md) steps 2–3 but run the production build:
   `npm run build` then `npm start`.
2. Keep it running at boot: Task Scheduler → *At startup* → `cmd /c cd /d C:\printshare\web && npm start`
   (or use NSSM to wrap it as a service — the **web server** is fine as a service; the **bridge** is not, see below).
3. Publish HTTPS with a tunnel, e.g. Cloudflare Tunnel to `http://localhost:3000`. Set `APP_URL=https://<tunnel host>`
   and `TRUST_PROXY=true`.
4. Pair the bridge with `http://localhost:3000` (same machine) or the public HTTPS URL.

## Bridge on the printer PC

- Install from the zip produced by `bridge-windows/publish.ps1` (self-contained; no .NET needed).
- Keep the PC awake while printing is expected (Power settings → *Sleep: Never* when plugged in), or jobs wait until it wakes.
- **Start with Windows** runs it at sign-in (recommended). For a PC with nobody signed in, use Task Scheduler with
  `--headless` (*Run whether user is logged on or not*), under the account that has the HP driver installed. Windows
  services are not used because Microsoft does not support GDI printing from services.

## Configuration reference (`web/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection |
| `APP_URL` | `http://localhost:3000` | Public origin (CSRF allow-list, links) |
| `SIGNING_SECRET` | — (≥ 32 chars) | HMAC for signed document URLs and bridge download tokens. Rotating it invalidates outstanding links only |
| `PORT`, `HOST` | `3000`, `0.0.0.0` | Listener |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For/Proto` from a reverse proxy |
| `STORAGE_DIR` | `./storage` | Document storage (not web-served) |
| `MAX_UPLOAD_MB` | `25` | Per-file limit |
| `DOCUMENT_TTL_HOURS` | `24` | Automatic deletion of documents |
| `LIBREOFFICE_PATH` | auto-detect | `soffice` path for DOCX/XLSX/PPTX |
| `LIBREOFFICE_TIMEOUT_MS` | `90000` | Conversion timeout |
| `CLAMAV_HOST`, `CLAMAV_PORT` | empty, `3310` | clamd for malware scanning |
| `MALWARE_SCAN_REQUIRED` | `false` | Reject uploads when the scanner is unavailable |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | — | Used by `npm run db:seed` |

## Operations

- **Backups:** PostgreSQL (`pg_dump`) daily. `STORAGE_DIR` holds only short-lived files.
- **Retention:** the server deletes expired documents every 10 minutes; `npm run cleanup` runs it on demand.
- **Upgrades:** deploy new code, `npx prisma migrate deploy`, restart. Update bridges by replacing the exe (settings
  and credentials live in `%LOCALAPPDATA%\PrintShare\Bridge`).
- **Scaling out:** realtime (Postgres NOTIFY) and job claiming work across instances. Use shared storage (or swap
  `src/server/storage.ts` for S3-compatible storage) and add rate limiting at the proxy.
- **Billing:** plans and limits are enforced (`Subscription`, `UsageRecord`); collecting payments is not integrated —
  administrators change plans in **Admin → Users**.
