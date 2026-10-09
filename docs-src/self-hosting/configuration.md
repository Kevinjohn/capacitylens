---
title: Configuration
description: Every CapacityLens environment variable, grouped by what you're trying to configure rather than alphabetically.
---

# Configuration

CapacityLens is configured entirely through environment variables, read from `.env` by
Docker Compose or set directly for a bare-metal run. `.env.example` in the repository is
the complete, authoritative register with defaults — this page groups the variables that
matter for a self-hosted install by what you're trying to do. Server variables
(`CAPACITYLENS_*`) take effect on restart. Client variables
(`VITE_CAPACITYLENS_*`) are baked into the web app at build time, so changing one needs a
rebuild.

## Listener settings

For a source checkout, use supported Node 24.19.0 or newer within 24.x and run `pnpm --filter capacitylens-server start`.
Node 26.9.0 or newer within 26.x is experimental, with best-effort compatibility and no complete
functionality guarantee. Other majors and versions below these floors are refused. Use current
patches within your runtime line; see [the compatibility policy](/reference/development#check-node-26-compatibility).
A release archive needs no pnpm: it starts with `node --env-file=<your env file> server/dist/index.mjs`.
The server binds to localhost by default. Set the host explicitly to expose it on a network.
Development-only variables, such as the test reset route and the development owner helper, are
listed in the [development guide](/reference/development#development-environment).

| Variable | What it does |
| --- | --- |
| `PORT` | Listen port. Default `8787`; invalid values outside the integer range 1–65,535 refuse startup. |
| `CAPACITYLENS_HOST` | Listen host. Default `127.0.0.1`; set `0.0.0.0` to expose the listener on the LAN or in a container. |
| `CAPACITYLENS_WEB_DIR` | Folder holding the built web app, which the server then serves beside the API. Unset: a release archive serves its own `dist/` folder, and a source checkout serves the API only. Set it empty to serve the API only. A folder without `index.html` refuses startup. |

## Sign-in mode

| Variable                                | What it does                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAPACITYLENS_MODE`                | `off`, `password-only`, `sso-only` or `password-and-sso`. `off` creates no sign-in at all. Under `NODE_ENV=production` an unset mode is `password-only`, and an explicit `off` refuses to boot unless you opt in (see below). Outside production, unset means `off`.                                                 |
| `CAPACITYLENS_DEPLOYMENT_PROFILE`  | An optional named policy: `self-hosted-password`, `self-hosted-mixed`, `self-hosted-sso-only` or `hosted-sso-only`. Enforced at startup.                                                       |
| `CAPACITYLENS_SECRET`              | The session-signing secret. Required for every authenticated mode. The `init` command generates one; anything 32 characters or longer is fine. |
| `CAPACITYLENS_PUBLIC_URL`          | The exact browser-facing origin, for example `https://capacity.example.com`. Required for every authenticated mode.                                                                             |
| `CAPACITYLENS_SETUP_TOKEN`         | The one-time secret the first owner enters on a fresh password-mode instance. For Google/Microsoft setup, use `CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS` for the first identity or a pre-authorised invitation after that. |
| `CAPACITYLENS_ALLOW_OPEN_SIGNUP`   | Re-opens self-service sign-up. Closed by default — CapacityLens is invite-only unless you set this. Leave it unset in production.                                                               |
| `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION` | Deliberately allows the auth-off (`off`) posture under production. Off by default; without it, a production instance with no sign-in refuses to start.                                          |

The optional deployment profile must match the mode: `self-hosted-password` requires
`password-only`, `self-hosted-mixed` requires `password-and-sso`, and both
`self-hosted-sso-only` and `hosted-sso-only` require `sso-only`. The mixed and SSO-only
profiles require Google or tenant-specific Microsoft. Without a profile, mixed mode can
also use experimental GitHub as its configured provider.

Treat `CAPACITYLENS_SETUP_TOKEN` as a short-lived bootstrap secret. Give the first owner the
value through a secure channel; never paste it into chat, tickets, screenshots, command output or
logs. The owner copies the value from the server `.env` file or installer into the matching field.
Do not add surrounding quote characters or whitespace in the browser: the submitted value must
match the configured secret exactly.

After the first owner account and company have been created, remove
`CAPACITYLENS_SETUP_TOKEN` from the server environment and restart the server. First-owner
signup already closes as soon as the first identity exists, but removing the secret invalidates the
handoff material instead of leaving it available to operators or future processes.

## Password checks

| Variable | What it does |
| --- | --- |
| `CAPACITYLENS_PASSWORD_BREACH_CHECK` | On by default: new passwords are checked against known breaches. Set `off` only for an isolated deployment that accepts the production warning. |

## Company login

Use [Set up company login](/company-login/set-up-company-login) for the registration steps.
Google and Microsoft are company providers. Configure either or both; a partial credential pair
refuses startup when provider sign-in is enabled. `password-only` ignores retained provider
credentials, `password-and-sso` enables password and configured provider sign-in, and `sso-only`
accepts only configured company providers. GitHub remains experimental in mixed mode and cannot
provide company-only access. Sign-in mode selects authentication methods, configured providers
select SSO options, and the current invitation policy determines who may join a company.

The `self-hosted-password` profile is stricter than unprofiled `password-only`: it rejects
external-provider settings at startup. Remove those settings before selecting that profile.

| Variable | What it does |
| --- | --- |
| `CAPACITYLENS_GOOGLE_CLIENT_ID` / `CAPACITYLENS_GOOGLE_CLIENT_SECRET` | Credentials for a Google web application. Use an Internal audience restricted to your Workspace organisation. |
| `CAPACITYLENS_MICROSOFT_CLIENT_ID` / `CAPACITYLENS_MICROSOFT_CLIENT_SECRET` | Application ID and secret value from your Microsoft Entra app registration. |
| `CAPACITYLENS_MICROSOFT_TENANT_ID` | Required organisation tenant GUID. `common`, `organizations`, personal-account tenants and a missing value are refused. |
| `CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS` | Comma-separated company email addresses allowed to create the first named-provider identity. Later new identities require an unused invitation addressed to them. |
| `CAPACITYLENS_GITHUB_CLIENT_ID` / `CAPACITYLENS_GITHUB_CLIENT_SECRET` | Optional credentials for the existing experimental GitHub sign-in in mixed mode. |

Register `https://your-capacitylens-address/api/auth/callback/google` for Google and
`https://your-capacitylens-address/api/auth/callback/microsoft` for Microsoft, using your actual
HTTPS origin. These paths must match exactly. Restart after changing server settings.

### Account email

Set `CAPACITYLENS_MAIL_HOST` and all the SMTP settings below to enable account email.
Addressed invitations are emailed automatically. **Invitation emailed to {address}** confirms
delivery to the SMTP service; the copyable invitation link remains available. If delivery fails,
copy and send the link yourself.

In password-capable modes, **Forgot password?** on the sign-in screen opens an email form.
Choose **Email reset link**, then open the link in the email to set a new password. The link
is single-use and expires after 24 hours. The confirmation is the same for every address;
unknown addresses and accounts using only company sign-in receive no reset email. Admin-issued
copy-links still send no email. With SMTP disabled, the sign-in form has no recovery-email control.

#### Microsoft verification email

Microsoft first connections may need a one-time email verification. All five SMTP settings are
required whenever Microsoft is configured, even if a particular identity arrives with adequate
verified-email claims. An SMTP failure blocks completion without granting access and allows retry.
Ordinary returning Microsoft sign-in does not require another verification email.

| Variable | What it does |
| --- | --- |
| `CAPACITYLENS_MAIL_HOST` | Your SMTP service hostname. |
| `CAPACITYLENS_MAIL_PORT` | SMTP port. Port 465 uses implicit TLS; other ports require STARTTLS. Certificate verification remains enabled. |
| `CAPACITYLENS_MAIL_USER` | SMTP authentication username. |
| `CAPACITYLENS_MAIL_PASSWORD` | SMTP password or service credential. Keep it in the server's secret configuration. |
| `CAPACITYLENS_MAIL_FROM` | A valid sender email address authorised by the SMTP service; use the address without a display name. |

The verification link expires after 15 minutes and must be confirmed in the browser that started
sign-in. See the [company-login guide](/company-login/set-up-company-login) for resend, expiry and
account-connection recovery.

`hosted-sso-only` is reserved for hosted deployments. It requires `mode=sso-only` and complete
Google and/or tenant-specific Microsoft configuration; it rejects passwords, GitHub, open signup
and incomplete provider settings. Self-hosted installations that require company sign-in use
`self-hosted-sso-only`. See [Require company sign-in](/company-login/move-to-single-sign-on).

## The database and backups

| Variable                           | What it does                                                                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAPACITYLENS_DB`                  | Path to the SQLite file. Docker Compose pins this to `/data/capacitylens.db` inside a named volume; only change it for a bare-metal run.                                                                  |
| `CAPACITYLENS_BACKUP_DIR`          | Directory for scheduled snapshots. On by default in Docker (`/backups`), and in production with a file database (a `backups` folder beside the database file). Set it explicitly empty (`CAPACITYLENS_BACKUP_DIR=`) to turn scheduled backups off.                                              |
| `CAPACITYLENS_BACKUP_INTERVAL_MIN` | Minutes between snapshots. Whole minutes, default 60; startup clamps over-maximum values to 35,000 with a warning.                                                                                        |
| `CAPACITYLENS_BACKUP_KEEP`         | How many snapshots to retain. Default 48. Invalid and lower values use the safe default; over-maximum values clamp to 10,000 with a startup warning, so leave disk capacity for that many restore points. |
| `CAPACITYLENS_AUDIT_FILE`          | Path to the audit log. Default `capacitylens-audit.jsonl` next to `CAPACITYLENS_DB`; Docker Compose pins it to `/data/capacitylens-audit.jsonl`. Only read when audit logging is on.                      |
| `CAPACITYLENS_AUDIT_MAX_MB`        | Audit log rotation size cap in MB. Default 64 — once the file reaches this size it's rotated to `<file>.1` (replacing any previous `.1`), bounding disk use to roughly twice the cap.                     |

See [Backups and restore](/self-hosting/backups-and-restore) for what these snapshots
protect against and how to use them. Back up the rotated `<file>.1` audit file alongside
the current one — a restore that only picks up the live file can miss recent audit
history still sitting in the rotated generation.

For a bare-metal run, the database defaults to `./capacitylens.db`; `:memory:` is also
accepted. Outside production, scheduled backups stay off unless `CAPACITYLENS_BACKUP_DIR` is set. Positive
fractional retention counts are rounded down.

Audit logging is on by default. Set `CAPACITYLENS_AUDIT=off` only for development;
production refuses disabled audit. Each mutation record contains `ts`, `userId`,
`accountId`, `action`, `entity`, `id` and `changedFields`. Changed fields are names,
never their values. A memory-only database uses a working-directory-relative audit file.

`CAPACITYLENS_AUDIT_MAX_MB` accepts integers from 1 to 1,048,576; missing or invalid
values use 64 MiB. Rotation happens before a record would cross the cap. A single
record larger than the cap is rejected and remains queued in the audit outbox.
The size setting is only read when audit logging is enabled.

## Origin, CORS and proxy trust

| Variable                           | What it does                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAPACITYLENS_CORS_ORIGIN`         | Comma-separated browser origins to allow, only needed if the web app and API are on different origins. Unset under production, it is the origin of `CAPACITYLENS_PUBLIC_URL`; outside production, local development origins. Explicitly empty allows none (Docker Compose passes it empty). Wildcards are rejected because browser requests use cookie credentials. |
| `CAPACITYLENS_HTTPS`               | Controls the two-year HSTS header. Unset, it is on when `CAPACITYLENS_PUBLIC_URL` is `https` and off otherwise. `1` forces it on; `0` forces it off, for a proxy that already emits its own HSTS. Any other value is treated as unset, so the URL scheme decides.                                                                                                                                                             |
| `CAPACITYLENS_TRUST_PROXY_HEADERS` | Trusts `X-Forwarded-For`/`X-Forwarded-Proto` from a non-loopback listener. Docker Compose sets this to `1` because its API only accepts connections from the packaged nginx. Loopback listeners (`127.0.0.1`, `localhost`, `::1`) trust their same-host proxy automatically without this flag. |

HSTS is host-only: it never covers subdomains. It is never sent over a plain-HTTP public URL unless
you force it on. The other baseline security headers are always enabled.

| Variable | What it does |
| --- | --- |
| `CAPACITYLENS_INTERNAL_TLS_CERT` | PEM certificate path for the internal reverse-proxy/API connection. |
| `CAPACITYLENS_INTERNAL_TLS_KEY` | Matching PEM private-key path. Omit both paths for HTTP on a trusted same-host loopback connection. A partial or unreadable identity refuses startup. Compose creates an identity per installation. |
| `CAPACITYLENS_INTERNAL_TLS_GENERATION` | Optional SHA-256 marker for the exact loaded certificate. |

See [TLS and networking](/self-hosting/tls-and-networking) for the full picture.

## Companies on this instance

| Variable                       | What it does                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAPACITYLENS_MULTI_ACCOUNT`   | Off by default: one company per instance. Set `1` to allow more than one.                                                                                                                 |
| `CAPACITYLENS_BOOTSTRAP_TOKEN` | A shared secret for creating an additional company through the API when the caller isn't already an owner or admin of one. Only matters when `CAPACITYLENS_MULTI_ACCOUNT=1`.              |
| `CAPACITYLENS_SEED_DEMO`       | Seeds a two-company sample dataset on a never-initialised database. Only makes sense paired with `CAPACITYLENS_MULTI_ACCOUNT=1`; use it for a throwaway or demo instance, not a real one. |

A fresh database starts empty unless demo seeding is explicitly enabled. The company
limit applies in every sign-in mode, including `off`. The bootstrap token is sent in
`x-capacitylens-bootstrap-token` to `POST /api/orgs`; an empty or unset token disables
that path. Without it, company creation requires first-run setup or an existing owner
or admin.

## Health, logging and rate limiting

| Variable                               | What it does                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `CAPACITYLENS_LOG`                     | Set `1` for structured per-request JSON logs. On by default in production.                                                         |
| `CAPACITYLENS_HEALTH_DEEP`             | Set `1` to make `/api/health` run a readiness query and report audit, backup and certificate status. On by default in production. |
| `CAPACITYLENS_RATE_LIMIT`              | Requests per minute per IP across rate-limited routes. Accepts integers 1–1,000,000. Production defaults to 300 when unset and refuses zero or invalid values. `/api/health` is exempt.                          |
| `CAPACITYLENS_AUDIT_STDOUT`            | Set `1` to also write each audit record to stdout as JSON, for a container log collector. On by default in production.                |

In production, a missing internal TLS identity is reported as a startup warning. It does not block
startup. Encrypting the storage and forwarding audit and security events to a separate collector
are your responsibility; CapacityLens has no setting for either.

Sign-in, sign-up and password changes have a stricter built-in limit of three attempts per
10 seconds per client, and reset and verification emails of three per minute. It is fixed and
applies only in production. The server identifies each client the same way for every limit:
by the connection address, or by the proxy's `X-Forwarded-For` when proxy headers are trusted
(see `CAPACITYLENS_TRUST_PROXY_HEADERS`). A client cannot choose its own address.

Invitation and joining-verification emails have a fixed send budget in every mode. A company can
send five invitation emails an hour to any one address and fifty in total, and one address can
receive five joining-verification emails an hour. One company's invitations never use up another
company's budget or a person's own verification emails. Over the budget an
invitation is still created and its link can be copied and shared by hand; a joining
verification request is refused until the hour has passed. The budget resets when the server
restarts.

Without structured logging, the server prints its startup line and reports server errors
to stderr. Deep health checks are off by default outside production (on under `NODE_ENV=production`): without them `/api/health` returns `{ ok: true }`.
With deep checks enabled, the endpoint runs `SELECT 1`, reports audit state and pending
records, and includes internal certificate expiry when configured. Failed readiness
returns HTTP 503 with `{ ok: false }`.

See [Monitoring and health checks](/self-hosting/monitoring) for what to do with these.

## What the web app is built with

| Variable                            | What it does                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_CAPACITYLENS_API`             | The API origin the built app talks to. Leave empty for the normal same-origin build (the app calls a relative `/api`, which nginx proxies). Only set this to point the app at a different origin. |
| `VITE_CAPACITYLENS_DEMO`            | Set `1` to build the in-memory demo instead of the real app. Wins over `VITE_CAPACITYLENS_API` if both are set.                                                                                   |
| `VITE_CAPACITYLENS_BUILD_SHA`       | Optional build identifier shown in Settings, typically the git commit.                                                                                                                            |
| `VITE_CAPACITYLENS_FEEDBACK_MAILTO` | Optional email address for the in-app feedback link. Leave empty to hide the link.                                                                                                                |

Any of these needs a rebuild to take effect. Use `docker compose build web` for the
packaged production stack, or `pnpm run build` for a source build, then redeploy the rebuilt
web files. A release archive's web app is already built with the same-origin defaults, so these
settings do not apply to it. Setting them only in a running process does nothing.

## What's next

- [Install with Docker](/self-hosting/install-with-docker) if you haven't set these yet.
- [TLS and networking](/self-hosting/tls-and-networking) for the proxy and cookie
  requirements these variables assume.
