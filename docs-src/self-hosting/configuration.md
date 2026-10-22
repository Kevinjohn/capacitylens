---
title: Configuration
description: Configure the AdonisJS application, SQLite database, company sign-in, mail, backups and trusted proxy.
---

# Configuration

Start from `capacitylens.env.example` in the native release archive. Keep the environment file
outside the release directory, restrict its permissions, and never commit or log its contents.
Restart the single backend process after changing its environment.

## Runtime and database

| Setting | Purpose |
| --- | --- |
| `NODE_ENV` | Set to `production` for a deployed service. |
| `HOST`, `PORT` | Listener address and port. The supplied release example binds loopback on port 8787. |
| `APP_URL` | Canonical public application URL, including `https://` when TLS ends at a proxy. |
| `APP_KEY` | Adonis encryption key. Generate it from `backend/` with `node ace.js generate:key --show`; keep it stable and secret. |
| `SESSION_DRIVER` | Use `database` for a deployed application. |
| `CAPACITYLENS_DB` | SQLite database path. Put it in persistent storage outside the release. |
| `CAPACITYLENS_SECRET` | Independent application secret used by product account operations. |
| `CAPACITYLENS_PUBLIC_URL` | Public origin used for sign-in callbacks and addressed links. Match `APP_URL`. |
| `CAPACITYLENS_SETUP_TOKEN` | One-time secret for first-run identity setup. Remove it after the first identity exists. |

Run `node ace.js app:upgrade` with the service stopped before the first start and after each
release. The application uses one SQLite connection and one writer process per database file.

## Company sign-in

`CAPACITYLENS_MODE` accepts `password-only`, `password-and-sso`, or `sso-only` for a normal
installation. Every persisted installation requires sign-in; `off` is retired and is rejected.
Configure both `CAPACITYLENS_GOOGLE_CLIENT_ID` and
`CAPACITYLENS_GOOGLE_CLIENT_SECRET` to offer Google. The callback URL is
`<CAPACITYLENS_PUBLIC_URL>/api/auth/callback/google`. Set
`CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS` for the first Google identity; later new identities need
an addressed invitation. Password mode may include Google. `sso-only` removes password sign-in.
Microsoft sign-in is deferred and GitHub sign-in is retired. Live Google acceptance must be checked
with the operator's actual registration; deterministic tests do not prove it.

Keep `CAPACITYLENS_ALLOW_OPEN_SIGNUP` unset unless you intentionally allow open registration.
All persisted data access still requires a signed-in company member.

## Email

Set all of `CAPACITYLENS_MAIL_HOST`, `CAPACITYLENS_MAIL_PORT`, `CAPACITYLENS_MAIL_USER`,
`CAPACITYLENS_MAIL_PASSWORD` and `CAPACITYLENS_MAIL_FROM` to enable SMTP. Port 465 uses implicit
TLS; other ports use STARTTLS with certificate verification. Without a host, mail delivery is not
configured; invitation and recovery flows that require delivery cannot complete.

## Backups

`CAPACITYLENS_BACKUP_DIR` enables an online SQLite snapshot at web-service startup and every 24
hours while it runs. The directory must be private and writable by the service user. Leave it
unset only when you have an explicitly managed backup process. The old
`CAPACITYLENS_BACKUP_INTERVAL_MIN` setting is no longer used.

`CAPACITYLENS_BACKUP_KEEP` retains the newest completed managed snapshots, defaulting to 48.
Positive fractional values are floored to whole snapshots; invalid or nonpositive values use 48
with a startup warning, and values above 10,000 clamp to 10,000 with a warning. Pre-upgrade
snapshots and unrelated files are excluded from scheduled/manual retention. Check backup logs and
completed files separately from database readiness; see [Backups and restore](/self-hosting/backups-and-restore).

## Network and logging

Set `CAPACITYLENS_TRUST_PROXY_HEADERS=1` only when the application listener is reachable solely
through a trusted proxy on the same host that overwrites forwarded headers. The application then
trusts forwarded client address and scheme headers from loopback connections only. Keep `APP_URL`
and `CAPACITYLENS_PUBLIC_URL` aligned with the browser-visible address. An HTTPS public URL makes
the application send a host-only one-year HSTS header and mark its cookies `Secure`; an HTTP public
URL sends no HSTS and uses plain cookies. The supplied nginx file leaves HSTS to the application
and does not configure CSP reporting. `CAPACITYLENS_CORS_ORIGIN` is
only needed when the browser app and API use different origins.

`CAPACITYLENS_LOG=1` enables routine request-completion logs. Sensitive request/response values are
redacted, and unexpected failures remain logged without their private messages. Set
`CAPACITYLENS_RATE_LIMIT` to change the process-wide request limit; it is not a per-company
reservation.
