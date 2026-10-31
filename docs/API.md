# API reference

JSON over HTTPS. Errors: `{ "error": { "code": "…", "message": "…", "details": { "fields": { "field": "message" } } } }`
with a matching HTTP status (400 validation, 401, 403, 404, 409 conflict/state, 413, 422, 429 + `Retry-After`).

**Browser auth:** `ps_session` cookie (set by register/login). Mutations must come from the same origin.
**Native clients:** `POST /api/auth/login` with `"tokenMode": true` returns `token`; send `Authorization: Bearer <token>`.
**Bridge auth:** `Authorization: Bearer <bridgeId>.<secret>`.

## Auth

| Method | Path | Body / notes |
|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password (≥10) }` → `201 { user }` + cookie |
| POST | `/api/auth/login` | `{ email, password, tokenMode? }` → `{ user, token? }` |
| POST | `/api/auth/logout` | Revokes the current session |
| GET | `/api/auth/me` | `{ user, subscription, usage }` (usage: pages used/limit, job counts, 14-day daily pages) |
| GET | `/api/auth/sessions` | Signed-in devices |
| DELETE | `/api/auth/sessions/:id` | Sign a device out |

## Documents

| Method | Path | Notes |
|---|---|---|
| POST | `/api/documents/upload` | multipart field `file`; PDF/JPG/JPEG/PNG/DOCX/XLSX/PPTX/TXT; → `201 { document }` with `pageCount`. 413 too large, 422 `UNSUPPORTED_TYPE` / `CONTENT_MISMATCH` / `INVALID_PDF` / `ENCRYPTED_PDF` / `CONVERSION_UNAVAILABLE` / `MALWARE_DETECTED` |
| GET | `/api/documents?limit&cursor` | Live documents (newest first) |
| GET | `/api/documents/:id` | `{ document }` incl. 15-min signed `pdfUrl` / `originalUrl` |
| GET | `/api/documents/:id/file?variant=pdf\|original&token=` | Streams the file (signed token or owner session) |
| DELETE | `/api/documents/:id` | 409 `DOCUMENT_IN_USE` while a job is active |

## Printers and bridges

| Method | Path | Notes |
|---|---|---|
| GET | `/api/printers` | `{ printers }` with state, availability, effective capabilities, bridge |
| POST | `/api/printers/register` | `{ bridgeId, systemName, name }` — must be a printer the bridge reported. 403 `PLAN_LIMIT` |
| GET | `/api/printers/:id` | `{ printer, model }` |
| PATCH | `/api/printers/:id` | `{ name }` |
| DELETE | `/api/printers/:id` | Soft remove; cancels unstarted jobs |
| POST | `/api/printers/:id/test` | Generates and queues a diagnostic test page (not counted in usage) |
| POST | `/api/printers/:id/reconnect` | Asks the bridge to re-check printers now. 409 `BRIDGE_OFFLINE` |
| GET | `/api/bridges` | Paired bridges with detected printers |
| POST | `/api/bridges/pairing-code` | `201 { code: "ABCD-EFGH", expiresAt }` (single use, 10 min) |
| DELETE | `/api/bridges/:id` | Revoke |

## Print jobs

| Method | Path | Notes |
|---|---|---|
| POST | `/api/print-jobs` | `{ documentId, printerId, settings: { copies, pageRange?, paperSize, orientation, colorMode, duplex, quality, scaleMode } }` — validated against the printer's capabilities (400 with `fields`), plan quota (403 `QUOTA_EXCEEDED`) |
| GET | `/api/print-jobs?status=A,B&printerId&q&limit&cursor` | History |
| GET | `/api/print-jobs/:id` | Job + `events` timeline |
| POST | `/api/print-jobs/:id/cancel` | Immediate if not started; otherwise `cancelRequested` until the bridge confirms |
| POST | `/api/print-jobs/:id/retry` | FAILED/CANCELLED → QUEUED, `attempt + 1` |

Statuses: `UPLOADED, QUEUED, PROCESSING, PRINTING, COMPLETED, FAILED, CANCELLED`.

## Bridge (device) API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/bridge/register` | `{ pairingCode, name, os?, appVersion? }` → `{ bridgeId, bridgeToken, account, heartbeatIntervalSeconds, pollIntervalSeconds }` |
| POST | `/api/bridge/heartbeat` | `{ appVersion, os, paused, printers: [{ systemName, driverName, portName, isDefault, state, stateMessage, capabilities }] }` → `{ cancelJobIds, printers: [{ id, systemName, name }] }` |
| GET | `/api/bridge/jobs?ready=<printerId,…>` | In-flight + newly claimed jobs with `document.downloadUrl`, `sha256`, `settings.pages` (explicit list), `dpi` |
| GET | `/api/bridge/jobs/:id/document?token=` | PDF stream; `X-Document-Sha256` |
| POST | `/api/bridge/jobs/:id/status` | `{ attempt, status, message?, errorCode?, spoolJobId?, pagesPrinted?, printerAlert?, printerState?, confirmation? }`. `COMPLETED` requires `confirmation.source ∈ {SPOOLER_PRINTED_FLAG, SPOOLER_COMPLETE_FLAG, SPOOLER_QUEUE_DRAINED}` and a spooler job id. `QUEUED` releases a job that was not spooled. 409 `STALE_ATTEMPT` / `JOB_FINISHED` / `INVALID_TRANSITION` |

## Admin (role ADMIN)

`GET /api/admin/stats` · `GET /api/admin/users?q` · `PATCH /api/admin/users/:id { role?, status?, plan? }` ·
`GET /api/admin/printers` (printers + bridges) · `DELETE /api/admin/printers/:id` · `DELETE /api/admin/bridges/:id` ·
`GET /api/admin/health` (checks + recent audit log)

## Other

`GET /api/health` (public liveness/readiness) · `GET /manifest.webmanifest` · WebSocket `GET /ws`
(browser: session cookie; bridge: bearer credential). Browser events: `job.updated`, `printer.updated`,
`bridge.updated`, `document.updated`. Bridge events: `job.available`, `job.cancel`, `printers.refresh`, `bridge.revoked`.
