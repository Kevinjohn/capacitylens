---
title: Configuration
description: Every CapacityLens environment variable, grouped by job, starting with the five lines init writes.
---

# Configuration

`init` writes the five lines a production install needs. Everything else has a default.

```dotenv
NODE_ENV=production
CAPACITYLENS_PUBLIC_URL=https://capacity.example.com
CAPACITYLENS_SECRET=<generated>
CAPACITYLENS_SETUP_TOKEN=<generated>
CAPACITYLENS_DB=/var/lib/capacitylens/capacitylens.db
```

Docker Compose reads variables from `.env`; a native install reads its environment file. Server
variables (`CAPACITYLENS_*`) take effect on restart. Web app variables (`VITE_CAPACITYLENS_*`) are
built into the app and need a rebuild. `.env.example` in the repository is the complete register
with defaults. Development-only variables, such as the test reset route and the development owner
helper, are in the [development guide](/reference/development#development-environment).

## Sign-in mode

| Variable | What it does |
| --- | --- |
| `CAPACITYLENS_MODE` | `off`, `password-only`, `sso-only` or `password-and-sso`. `off` creates no sign-in at all. Under `NODE_ENV=production` an unset mode is `password-only`, and an explicit `off` refuses to boot unless you opt in (see below). Outside production, unset means `off`. |
| `CAPACITYLENS_DEPLOYMENT_PROFILE` | An optional named policy: `self-hosted-password`, `self-hosted-mixed`, `self-hosted-sso-only` or `hosted-sso-only`. Enforced at startup. |
| `CAPACITYLENS_SECRET` | The session-signing secret. Required for every authenticated mode. The `init` command generates one; anything 32 characters or longer is fine. |
| `CAPACITYLENS_PUBLIC_URL` | The exact browser-facing origin, for example `https://capacity.example.com`. Required for every authenticated mode. |
| `CAPACITYLENS_SETUP_TOKEN` | The one-time secret the first Owner enters on a fresh password-mode instance. For Google/Microsoft setup, use `CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS` for the first identity or a pre-authorised invitation after that. |
| `CAPACITYLENS_ALLOW_OPEN_SIGNUP` | Re-opens self-service sign-up. Closed by default: CapacityLens is invite-only. Leave it unset in production. |
| `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION` | Allows the `off` posture under production. Without it, a production instance with no sign-in refuses to start. |
| `CAPACITYLENS_PASSWORD_BREACH_CHECK` | On by default: new passwords are checked against known breaches. Set `off` only for an isolated deployment that accepts the production warning. |

A profile must match the mode: `self-hosted-password` requires `password-only`,
`self-hosted-mixed` requires `password-and-sso`, and `self-hosted-sso-only` and `hosted-sso-only`
require `sso-only`. The mixed and SSO-only profiles require Google or tenant-specific Microsoft.
Without a profile, mixed mode can also use experimental GitHub. `hosted-sso-only` is reserved for
hosted deployments; a self-hosted installation that requires company sign-in uses
`self-hosted-sso-only` (see [Require company sign-in](/company-login/move-to-single-sign-on)).

Send the setup token to the first Owner through a secure channel, never in chat, tickets,
screenshots, command output or logs. It must be entered exactly, without surrounding quotes or
whitespace. Once the first Owner and company exist, remove `CAPACITYLENS_SETUP_TOKEN` and restart.
First-Owner signup already closes when the first identity exists; removing the token takes the
secret away from operators and future processes.

## Company login

| Variable | What it does |
| --- | --- |
| `CAPACITYLENS_GOOGLE_CLIENT_ID` / `CAPACITYLENS_GOOGLE_CLIENT_SECRET` | Credentials for a Google web application. Use an Internal audience restricted to your Workspace organisation. |
| `CAPACITYLENS_MICROSOFT_CLIENT_ID` / `CAPACITYLENS_MICROSOFT_CLIENT_SECRET` | Application ID and secret value from your Microsoft Entra app registration. |
| `CAPACITYLENS_MICROSOFT_TENANT_ID` | Required organisation tenant GUID. `common`, `organizations`, personal-account tenants and a missing value are refused. |
| `CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS` | Comma-separated company email addresses allowed to create the first named-provider identity. Later new identities require an unused invitation addressed to them. |
| `CAPACITYLENS_GITHUB_CLIENT_ID` / `CAPACITYLENS_GITHUB_CLIENT_SECRET` | Optional credentials for the experimental GitHub sign-in in mixed mode. |

[Set up company login](/company-login/set-up-company-login) has the registration steps. Register
`https://your-capacitylens-address/api/auth/callback/google` for Google and
`https://your-capacitylens-address/api/auth/callback/microsoft` for Microsoft, using your actual
HTTPS origin. These paths must match exactly. Restart after changing these settings.

- A partial credential pair refuses startup when provider sign-in is enabled.
- `password-only` ignores retained provider credentials. The `self-hosted-password` profile
  rejects them, and the account email settings, at startup: remove them before selecting it.
- `password-and-sso` enables password and configured provider sign-in; `sso-only` accepts only
  configured company providers. GitHub cannot provide company-only access.
- Microsoft also needs all five [account email](#account-email) settings.
- The invitation policy, not the sign-in mode, decides who may join a company.

## Account email

| Variable | What it does |
| --- | --- |
| `CAPACITYLENS_MAIL_HOST` | Your SMTP service hostname. Setting it and the four below enables account email. |
| `CAPACITYLENS_MAIL_PORT` | SMTP port. Port 465 uses implicit TLS; other ports require STARTTLS. Certificate verification remains enabled. |
| `CAPACITYLENS_MAIL_USER` | SMTP authentication username. |
| `CAPACITYLENS_MAIL_PASSWORD` | SMTP password or service credential. Keep it in the server's secret configuration. |
| `CAPACITYLENS_MAIL_FROM` | A valid sender address authorised by the SMTP service, without a display name. |

The `self-hosted-password` deployment profile refuses to start with these settings. Remove the
profile line, or change it to `self-hosted-mixed` when you also add company login.

With email on:

- Addressed invitations are emailed automatically. **Invitation emailed to {address}** confirms
  delivery to the SMTP service; the link can still be copied, so if delivery fails, send it
  yourself.
- In `password-only` and `password-and-sso` modes, **Forgot password?** on the sign-in screen
  sends a single-use reset link through **Email reset link**, valid for 24 hours. The
  confirmation is the same for every address; unknown addresses and accounts using only company
  sign-in receive no email. Admin-issued copy-links send no email. With SMTP disabled, the sign-in form has no
  recovery-email control.
- A first Microsoft connection may need a one-time email verification, so all five settings are
  required whenever Microsoft is configured. The link expires after 15 minutes and must be
  confirmed in the browser that started sign-in. An SMTP failure blocks completion without
  granting access and allows retry. Returning Microsoft sign-in sends no further email. The
  [company-login guide](/company-login/set-up-company-login) covers resend, expiry and recovery.

## The database and backups

| Variable | What it does |
| --- | --- |
| `CAPACITYLENS_DB` | Path to the SQLite file. Default `./capacitylens.db`; `:memory:` is also accepted. Docker Compose pins this to `/data/capacitylens.db` inside a named volume; only change it on a Linux host. |
| `CAPACITYLENS_BACKUP_DIR` | Directory for scheduled snapshots. On by default in Docker (`/backups`), and in production with a file database (a `backups` folder beside the database file). Set it explicitly empty (`CAPACITYLENS_BACKUP_DIR=`) to turn scheduled backups off. Outside production, off unless set. |
| `CAPACITYLENS_BACKUP_INTERVAL_MIN` | Minutes between snapshots. Whole minutes, default 60; startup clamps over-maximum values to 35,000 with a warning. |
| `CAPACITYLENS_BACKUP_KEEP` | How many snapshots to retain. Default 48. Invalid and lower values use the safe default and positive fractions round down; over-maximum values clamp to 10,000 with a startup warning, so leave disk capacity for that many restore points. |
| `CAPACITYLENS_AUDIT` | Audit logging, on by default. Set `off` only for development; production refuses disabled audit. |
| `CAPACITYLENS_AUDIT_FILE` | Path to the audit log. Default `capacitylens-audit.jsonl` next to `CAPACITYLENS_DB` (working-directory-relative for a memory-only database); Docker Compose pins it to `/data/capacitylens-audit.jsonl`. |
| `CAPACITYLENS_AUDIT_MAX_MB` | Rotation size cap, integers 1 to 1,048,576; missing or invalid values use 64. Before a record would cross the cap, the file rotates to `<file>.1` (replacing any previous `.1`), bounding disk use to roughly twice the cap. |

Both audit file settings are read only when audit logging is on. Each mutation record contains
`ts`, `userId`, `accountId`, `action`, `entity`, `id` and `changedFields`, which lists field names,
never values. A single record larger than the cap is rejected and stays queued in the audit outbox.
Back up the rotated `<file>.1` with the current file, or a restore can miss recent audit history.
[Backups and restore](/self-hosting/backups-and-restore) covers what snapshots protect and how to
restore.

## Network and proxy

| Variable | What it does |
| --- | --- |
| `PORT` | Listen port. Default `8787`; values outside the integer range 1–65,535 refuse startup. |
| `CAPACITYLENS_HOST` | Listen host. Default `127.0.0.1`; set `0.0.0.0` to expose the listener on the LAN or in a container. |
| `CAPACITYLENS_WEB_DIR` | Folder holding the built web app, served beside the API. Unset: a release archive serves its own `dist/` folder, and a source checkout serves the API only. Set it empty to serve the API only. A folder without `index.html` refuses startup. |
| `CAPACITYLENS_CORS_ORIGIN` | Comma-separated browser origins to allow, only needed if the web app and API are on different origins. Unset under production, it is the origin of `CAPACITYLENS_PUBLIC_URL`; outside production, local development origins. Explicitly empty allows none (Docker Compose passes it empty). Wildcards are rejected because browser requests use cookie credentials. |
| `CAPACITYLENS_HTTPS` | Controls the two-year, host-only HSTS header. Unset, it is on when `CAPACITYLENS_PUBLIC_URL` is `https` and off otherwise. `1` forces it on; `0` forces it off, for a proxy that already emits its own HSTS. Any other value is treated as unset. |
| `CAPACITYLENS_TRUST_PROXY_HEADERS` | Trusts `X-Forwarded-For`/`X-Forwarded-Proto` from a non-loopback listener. Docker Compose sets this to `1` because its API only accepts connections from the packaged nginx. Loopback listeners (`127.0.0.1`, `localhost`, `::1`) trust their same-host proxy without it. |
| `CAPACITYLENS_INTERNAL_TLS_CERT` | PEM certificate path for the internal reverse-proxy/API connection. |
| `CAPACITYLENS_INTERNAL_TLS_KEY` | Matching PEM private-key path. Omit both paths for HTTP on a trusted same-host loopback connection. A partial or unreadable identity refuses startup. Compose creates an identity per installation. |
| `CAPACITYLENS_INTERNAL_TLS_GENERATION` | Optional SHA-256 marker for the exact loaded certificate. |

The other baseline security headers are always on. In production, a missing internal TLS identity
is a startup warning, not a refusal. [TLS and networking](/self-hosting/tls-and-networking) has the
full topology.

## Health, logging and limits

| Variable | What it does |
| --- | --- |
| `CAPACITYLENS_LOG` | Set `1` for structured per-request JSON logs. On by default in production. Without it, the server prints its startup line and reports server errors to stderr. |
| `CAPACITYLENS_HEALTH_DEEP` | Set `1` to make `/api/health` run `SELECT 1` and report audit state, pending records, backup status and internal certificate expiry. Failed readiness returns HTTP 503 with `{ ok: false }`. On by default in production; without it, `/api/health` returns `{ ok: true }`. |
| `CAPACITYLENS_RATE_LIMIT` | Requests per minute per IP across rate-limited routes. Integers 1–1,000,000. Production defaults to 300 when unset and refuses zero or invalid values. `/api/health` is exempt. |
| `CAPACITYLENS_AUDIT_STDOUT` | Set `1` to also write each audit record to stdout as JSON, for a container log collector. On by default in production. |

These limits are fixed:

- In production, sign-in, sign-up and password changes allow three attempts per 10 seconds per
  client, and reset and verification emails three per minute. A client is identified by its
  connection address, or by the proxy's `X-Forwarded-For` when proxy headers are trusted. A client
  cannot choose its own address.
- In every mode, a company can send five invitation emails an hour to any one address and fifty
  in total, and one address can receive five joining-verification emails an hour. One company's
  invitations never use up another company's budget or a person's own verification emails. Over
  the budget, an invitation is still created and its link can be shared by hand; a joining
  verification request is refused until the hour has passed. The budget resets when the server
  restarts.

Encrypting storage and forwarding audit and security events to a separate collector are your
responsibility; CapacityLens has no setting for either.
[Monitoring and health checks](/self-hosting/monitoring) explains what to watch.

## Companies on this instance

| Variable | What it does |
| --- | --- |
| `CAPACITYLENS_MULTI_ACCOUNT` | Off by default: one company per instance, in every sign-in mode including `off`. Set `1` to allow more than one. |
| `CAPACITYLENS_BOOTSTRAP_TOKEN` | Shared secret, sent in `x-capacitylens-bootstrap-token` to `POST /api/orgs`, for creating an additional company when the caller isn't already an Owner or Admin of one. Only matters when `CAPACITYLENS_MULTI_ACCOUNT=1`. Empty or unset disables that path. |
| `CAPACITYLENS_SEED_DEMO` | Seeds a two-company sample dataset on a never-initialised database. Pair it with `CAPACITYLENS_MULTI_ACCOUNT=1`, for a throwaway or demo instance only. Without it, a fresh database starts empty. |

## Web app build

| Variable | What it does |
| --- | --- |
| `VITE_CAPACITYLENS_API` | The API origin the built app talks to. Leave empty for the normal same-origin build (the app calls a relative `/api`, which nginx proxies). |
| `VITE_CAPACITYLENS_DEMO` | Set `1` to build the in-memory demo instead of the real app. Wins over `VITE_CAPACITYLENS_API`. |
| `VITE_CAPACITYLENS_BUILD_SHA` | Optional build identifier shown under **Build details** in Diagnostics, typically the git commit. |
| `VITE_CAPACITYLENS_FEEDBACK_MAILTO` | Optional email address for the in-app feedback link. Leave empty to hide the link. |

These apply only after a rebuild: `docker compose build web` for the packaged stack or
`pnpm run build` for a source build, then redeploy the web files. A release archive's web app is
already built with the same-origin defaults, so they do not apply to it.
