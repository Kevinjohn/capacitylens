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
rebuild.

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

## Origin, CORS and proxy trust

| Variable                           | What it does                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAPACITYLENS_CORS_ORIGIN`         | Comma-separated browser origins to allow, only needed if the web app and API are on different origins. Unset means fail-closed: no cross-origin API calls, which is correct for the packaged same-origin nginx setup.                                                                          |
| `CAPACITYLENS_HTTPS`               | Set `1` when the public origin is genuinely HTTPS, to enable a two-year HSTS header. Leave unset if your proxy already emits HSTS.                                                                                                                                                             |
| `CAPACITYLENS_TRUST_PROXY_HEADERS` | Trusts `X-Forwarded-For`/`X-Forwarded-Proto` from a non-loopback listener. Docker Compose sets this to `1` because its API only accepts connections from the packaged nginx. Loopback listeners (`127.0.0.1`, `localhost`, `::1`) trust their same-host proxy automatically without this flag. |

See [TLS and networking](/self-hosting/tls-and-networking) for the full picture.

## Companies on this instance

| Variable                       | What it does                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAPACITYLENS_MULTI_ACCOUNT`   | Off by default: one company per instance. Set `1` to allow more than one.                                                                                                                 |
| `CAPACITYLENS_BOOTSTRAP_TOKEN` | A shared secret for creating an additional company through the API when the caller isn't already an owner or admin of one. Only matters when `CAPACITYLENS_MULTI_ACCOUNT=1`.              |
| `CAPACITYLENS_SEED_DEMO`       | Seeds a two-company sample dataset on a never-initialised database. Only makes sense paired with `CAPACITYLENS_MULTI_ACCOUNT=1`; use it for a throwaway or demo instance, not a real one. |

## Health, logging and rate limiting

| Variable                               | What it does                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `CAPACITYLENS_LOG`                     | Set `1` for structured per-request JSON logs. Recommended for a real deployment.                                                   |
| `CAPACITYLENS_HEALTH_DEEP`             | Set `1` to make `/api/health` run a readiness query and report audit, backup and certificate status. Compose sets this by default. |
| `CAPACITYLENS_RATE_LIMIT`              | Requests per minute per IP across rate-limited routes. Production refuses to start with it unset or zero.                          |
| `CAPACITYLENS_AUDIT_STDOUT`            | Set `1` to also write each audit record to stdout as JSON, for a container log collector. Compose defaults this on.                |
| `CAPACITYLENS_SECURITY_LOG_FORWARDING` | An attestation that you're forwarding audit and security events to a separate collector. Doesn't create the collector itself.      |

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
