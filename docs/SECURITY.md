# Security

## Threat model (summary)

| Asset | Threat | Control |
|---|---|---|
| User accounts | Credential stuffing, enumeration | argon2id (19 MiB, t=2); per-IP and per-email login rate limits; dummy hash for unknown emails; audit `auth.login_failed` |
| Sessions | Theft, CSRF | 32-byte random token, only its SHA-256 stored; `httpOnly`, `SameSite=Lax`, `Secure` on HTTPS; 30-day sliding expiry; list/revoke devices; mutations require same-origin `Origin` |
| Documents | Cross-user access, link leakage | Every query filtered by `userId`; files outside the web root under random keys; access via owner session or **15-min HMAC-signed URL** bound to document + variant; `Cache-Control: private, no-store`; automatic deletion (`DOCUMENT_TTL_HOURS`) |
| Uploads | Malware, disguised executables, parser bombs | Extension allow-list **and** magic-byte check; size limit enforced before buffering; ClamAV `INSTREAM` hook (optionally mandatory); Sharp pixel limit; LibreOffice in an isolated profile with timeout and concurrency cap; encrypted PDFs rejected |
| Printers | Unauthorised printing | Printers belong to one user; jobs require owning both document and printer; bridges only receive jobs for their own printers; rate limits on job creation |
| Bridge credential | Theft, replay | Issued once via single-use, 10-min, hashed pairing code; secret stored hashed server-side, **DPAPI-encrypted** on the PC; revocable instantly (server closes its WebSocket) |
| Bridge downloads | Tampering, misdirection | Bridge credential **plus** 10-min token bound to job + bridge + attempt; bridge refuses absolute URLs, verifies size and **SHA-256** before printing |
| Printer network | Exposure | No inbound ports — the bridge connects outward over HTTPS/WSS; HTTPS mandatory except loopback |
| Admin | Privilege abuse | Role check on every admin endpoint; cannot demote/suspend self; suspension revokes sessions; all admin actions audited |

## HTTP hardening

`next.config.ts` sets CSP (`default-src 'self'`, no `object-src`, `frame-ancestors 'self'`), `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy` (camera/mic/geo/usb off) and HSTS in production. PDF.js is served from `/public`
so scripts stay same-origin. The custom server overwrites the internal `x-ps-client-ip`/`x-ps-proto` headers on every
request so clients cannot spoof them; `X-Forwarded-*` is honoured only with `TRUST_PROXY=true`.

## Data isolation checks (tested)

`web/tests/integration/print-flow.test.ts` asserts that another user gets **404** for a foreign document (detail and
file), job and printer; cannot register another user's bridge printer; forged signed URLs fail; cross-origin POSTs fail;
non-admins get 403 on admin APIs; revoked bridges get 401.

## Audit log

`AuditLog` records auth (register, login, failed login, logout, session revoke), uploads, malware detections,
pairing/registration/revocation of bridges, printer register/remove/reconnect/test, job create/cancel/retry/complete/fail,
and admin changes — with actor, IP and user agent. Visible in **Admin → System health**.

## Known limitations / operator responsibilities

- Rate limiting is per process; with several instances, also limit at the reverse proxy.
- Malware scanning is only as good as the configured ClamAV signatures; enable `MALWARE_SCAN_REQUIRED` in production.
- `SIGNING_SECRET` and `DATABASE_URL` must be kept secret; rotate `SIGNING_SECRET` if leaked (only short-lived links break).
- A Windows user with access to the bridge PC's profile can use its credential — protect that account; revoke the bridge
  from the dashboard if the PC is lost.
- Payment processing is not integrated, so there is no card data in scope.
