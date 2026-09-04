---
title: Configuration
description: Every CapacityLens environment variable, grouped by what you're trying to configure rather than alphabetically.
---

# Configuration

CapacityLens is configured entirely through environment variables, read from `.env` by
Docker Compose or set directly for a bare-metal run. `.env.example` in the repository is
the complete, authoritative register with defaults — this page groups the variables that
matter for a self-hosted install by what you're trying to do. Server variables
(`CAPACITYLENS_*`, `SMALLSASS_ACCOUNT_*`) take effect on restart. Client variables
(`VITE_CAPACITYLENS_*`) are baked into the web app at build time, so changing one needs a
rebuild. Two prefixes are deliberate: sign-in and accounts are built as a separable
platform component, so their settings carry the `SMALLSASS_ACCOUNT_` prefix, while
everything specific to the app itself uses `CAPACITYLENS_`.

## Listener and development settings

For a bare-metal run, use Node 24 or newer and run `pnpm --filter capacitylens-server start`.
The server binds to localhost by default. Set the host explicitly to expose it on a network.

| Variable | What it does |
| --- | --- |
| `PORT` | Listen port. Default `8787`; invalid values outside the integer range 1–65,535 refuse startup. |
| `CAPACITYLENS_HOST` | Listen host. Default `127.0.0.1`; set `0.0.0.0` to expose the listener on the LAN or in a container. |
| `CAPACITYLENS_ALLOW_RESET` | Set `1` to expose `POST /api/test/reset` for development and tests with sign-in off. Production refuses this setting. |
| `CAPACITYLENS_OPTIMISTIC_CONCURRENCY` | Enabled by default. Set `0` only to allow stale writes to overwrite newer changes. |
| `CAPACITYLENS_CREATE_ADMIN_ADMIN` | Development-only first-owner helper, also available as `--create-owner-admin-admin`. Creates `admin@admin.admin` only when the password user table is empty. Production refuses this setting. |
| `CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD` | Required password for that development-only owner helper. For production, use the account setup token instead. |

## Sign-in mode

| Variable                                | What it does                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMALLSASS_ACCOUNT_MODE`                | `off`, `password` or `sso`. `off` creates no sign-in at all; production refuses to boot with it unset unless you explicitly opt in (see below).                                                 |
| `SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE`  | An optional named policy: `self-hosted-password`, `self-hosted-mixed` or `self-hosted-sso-only`. Enforced at startup.                                                                           |
| `SMALLSASS_ACCOUNT_SECRET`              | The session-signing secret. Required for `password` or `sso` mode. Generate with `openssl rand -base64 48` — anything 32 characters or longer is fine; the install guide's command produces 48. |
| `SMALLSASS_ACCOUNT_PUBLIC_URL`          | The exact browser-facing origin, for example `https://capacity.example.com`. Required for `password` or `sso` mode.                                                                             |
| `SMALLSASS_ACCOUNT_SETUP_TOKEN`         | The one-time secret the first owner enters to create the first account. Required unless open signup or the bootstrap-admin escape hatch is enabled.                                             |
| `SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP`   | Re-opens self-service sign-up. Closed by default — CapacityLens is invite-only unless you set this. Leave it unset in production.                                                               |
| `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION` | Deliberately allows the auth-off (`off`) posture under production. Off by default; without it, a production instance with no sign-in refuses to start.                                          |

## Passwords and multi-factor sign-in

| Variable                                  | What it does                                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMALLSASS_ACCOUNT_REQUIRE_MFA`           | Set `1` to require every password-mode teammate to enroll multi-factor sign-in before they can see company data.                                |
| `SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK` | On by default: new passwords are checked against known breaches. Set `off` only for an isolated deployment that accepts the production warning. |

## Company login

Read [Set up company login](/company-login/set-up-company-login) first. These variables
configure the strict [OIDC](/reference/glossary) provider CapacityLens supports.

| Variable                                                                    | What it does                                                                                                                                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMALLSASS_ACCOUNT_OIDC_CLIENT_ID` / `SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET` | The client credentials from your company login provider. Both required for `sso` mode.                                                                                                         |
| `SMALLSASS_ACCOUNT_OIDC_ISSUER`                                             | The exact issuer URL your provider reports. Required.                                                                                                                                          |
| `SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL`                                      | The provider's `.well-known/openid-configuration` URL. Required — the authorisation, token, JWKS and user-info endpoints all come from discovery, not from manual overrides.                   |
| `SMALLSASS_ACCOUNT_OIDC_BOOTSTRAP_EMAILS`                                   | Comma-separated verified emails allowed to create the first company-login identity. Every identity after that needs a pre-authorised invitation instead.                                       |
| `SMALLSASS_ACCOUNT_OIDC_PROVIDER_ID`                                        | Optional id used in the sign-in route. Defaults to `sso`. Can't be a name CapacityLens already uses internally (`credential`, `generic-oauth`, `two-factor`, `google`, `microsoft`, `github`). |
| `SMALLSASS_ACCOUNT_OIDC_LABEL`                                              | Optional button label. Defaults to "Single sign-on".                                                                                                                                           |
| `SMALLSASS_ACCOUNT_OIDC_SCOPES`                                             | Space-separated scopes. Defaults to `openid profile email`, all of which are required.                                                                                                         |
| `SMALLSASS_ACCOUNT_SSO_MFA_ENFORCED`                                        | An attestation that your company login provider requires multi-factor sign-in for every admitted identity. Set it only after testing that policy.                                              |

Once the first successful startup has happened, the provider id and issuer are locked
together — changing either refuses startup, to protect existing sign-in records. See
[Move to single sign-on](/company-login/move-to-single-sign-on) for converting an
existing password installation.

Google, Microsoft and GitHub sign-in buttons are available and experimental through
`SMALLSASS_ACCOUNT_GOOGLE_CLIENT_ID`/`SMALLSASS_ACCOUNT_GOOGLE_CLIENT_SECRET` and the
equivalent Microsoft and GitHub pairs (Microsoft also takes an optional
`SMALLSASS_ACCOUNT_MICROSOFT_TENANT_ID`, defaulting to `common`). Each provider needs
both its id and secret set, or it's off. Strict OIDC above is the supported,
provider-neutral path.

## The database and backups

| Variable                           | What it does                                                                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAPACITYLENS_DB`                  | Path to the SQLite file. Docker Compose pins this to `/data/capacitylens.db` inside a named volume; only change it for a bare-metal run.                                                                  |
| `CAPACITYLENS_BACKUP_DIR`          | Directory for scheduled snapshots. On by default in Docker (`/backups`). Set it explicitly empty (`CAPACITYLENS_BACKUP_DIR=`) to turn scheduled backups off.                                              |
| `CAPACITYLENS_BACKUP_INTERVAL_MIN` | Minutes between snapshots. Whole minutes, default 60; startup clamps over-maximum values to 35,000 with a warning.                                                                                        |
| `CAPACITYLENS_BACKUP_KEEP`         | How many snapshots to retain. Default 48. Invalid and lower values use the safe default; over-maximum values clamp to 10,000 with a startup warning, so leave disk capacity for that many restore points. |
| `CAPACITYLENS_AUDIT_FILE`          | Path to the audit log. Default `capacitylens-audit.jsonl` next to `CAPACITYLENS_DB`; Docker Compose pins it to `/data/capacitylens-audit.jsonl`. Only read when audit logging is on.                      |
| `CAPACITYLENS_AUDIT_MAX_MB`        | Audit log rotation size cap in MB. Default 64 — once the file reaches this size it's rotated to `<file>.1` (replacing any previous `.1`), bounding disk use to roughly twice the cap.                     |

See [Backups and restore](/self-hosting/backups-and-restore) for what these snapshots
protect against and how to use them. Back up the rotated `<file>.1` audit file alongside
the current one — a restore that only picks up the live file can miss recent audit
history still sitting in the rotated generation.

For a bare-metal run, the database defaults to `./capacitylens.db`; `:memory:` is also
accepted. Scheduled backups stay off unless `CAPACITYLENS_BACKUP_DIR` is set. Positive
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
| `CAPACITYLENS_CORS_ORIGIN`         | Comma-separated browser origins to allow, only needed if the web app and API are on different origins. Defaults to local development origins. Wildcards are rejected because browser requests use cookie credentials.                                                                          |
| `CAPACITYLENS_HTTPS`               | Set `1` when the public origin is genuinely HTTPS, to enable a two-year HSTS header. Leave unset if your proxy already emits HSTS.                                                                                                                                                             |
| `CAPACITYLENS_TRUST_PROXY_HEADERS` | Trusts `X-Forwarded-For`/`X-Forwarded-Proto` from a non-loopback listener. Docker Compose sets this to `1` because its API only accepts connections from the packaged nginx. Loopback listeners (`127.0.0.1`, `localhost`, `::1`) trust their same-host proxy automatically without this flag. |

The HTTPS setting enables HSTS including subdomains. Leave it off for plain HTTP.
The other baseline security headers are always enabled.

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
| `CAPACITYLENS_LOG`                     | Set `1` for structured per-request JSON logs. Recommended for a real deployment.                                                   |
| `CAPACITYLENS_HEALTH_DEEP`             | Set `1` to make `/api/health` run a readiness query and report audit, backup and certificate status. Compose sets this by default. |
| `CAPACITYLENS_RATE_LIMIT`              | Requests per minute per IP across rate-limited routes. Accepts integers 1–1,000,000. Production refuses missing, zero or invalid values. `/api/health` is exempt.                          |
| `CAPACITYLENS_AUDIT_STDOUT`            | Set `1` to also write each audit record to stdout as JSON, for a container log collector. Compose defaults this on.                |
| `CAPACITYLENS_SECURITY_LOG_FORWARDING` | An attestation that you're forwarding audit and security events to a separate collector. Doesn't create the collector itself.      |

Without structured logging, the server prints its startup line and reports server errors
to stderr. Deep health checks are off by default: `/api/health` returns `{ ok: true }`.
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

Any of these needs a rebuild (`docker compose build web`, or `build web-client` for the
client-only image) to take effect — setting them in a running container's environment
does nothing.

## Older variable names

Earlier releases used `CAPACITYLENS_AUTH`, `BETTER_AUTH_*`, `CAPACITYLENS_SSO_*` and
named-social-provider variables with different names than the `SMALLSASS_ACCOUNT_*` ones
above. Those older names still work as aliases, but they're deprecated: CapacityLens
warns once, without logging the value, when it sees only the old name, and refuses to
start if an old and a new name are both set but disagree. Move to the `SMALLSASS_ACCOUNT_*`
names above when you next touch your configuration — the aliases won't be removed until
at least two stable minor releases and 90 days have passed since the canonical names
first shipped, so there's no rush, but new deployments should use the current names from
the start.

## What's next

- [Install with Docker](/self-hosting/install-with-docker) if you haven't set these yet.
- [TLS and networking](/self-hosting/tls-and-networking) for the proxy and cookie
  requirements these variables assume.
