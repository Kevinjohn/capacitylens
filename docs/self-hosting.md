# Self-hosting

The supported deployment shape is a same-origin web app and API behind TLS, with SQLite and
backups on persistent storage. Docker Compose is the shortest path; systemd/nginx works too.

## Requirements

- A host that can run Docker Compose, or Node 24 + nginx.
- A DNS name and TLS certificate for an internet-facing instance.
- Persistent storage for the database, audit log and snapshots.
- A separate off-host backup destination.

## Docker Compose

```bash
git clone https://github.com/Kevinjohn/capacitylens.git
cd capacitylens
cp .env.example .env
openssl rand -base64 48  # BETTER_AUTH_SECRET
openssl rand -base64 48  # CAPACITYLENS_SETUP_TOKEN
```

At minimum, edit `.env`:

```dotenv
CAPACITYLENS_AUTH=password
BETTER_AUTH_SECRET=<first generated value>
BETTER_AUTH_URL=https://capacity.example.com
CAPACITYLENS_SETUP_TOKEN=<second generated value>
CAPACITYLENS_HTTPS=1
CAPACITYLENS_REQUIRE_MFA=1
CAPACITYLENS_PASSWORD_BREACH_CHECK=on
CAPACITYLENS_RATE_LIMIT=300
CAPACITYLENS_AUDIT_STDOUT=1
CAPACITYLENS_STORAGE_ENCRYPTED=1
CAPACITYLENS_SECURITY_LOG_FORWARDING=1
```

The last two values are operator attestations, not controls implemented by the application. Set
`CAPACITYLENS_STORAGE_ENCRYPTED=1` only after the database, audit and backup volumes use host or
platform encryption at rest. Set `CAPACITYLENS_SECURITY_LOG_FORWARDING=1` only after process
security/audit JSON lines are shipped to a logically separate monitored destination. A production
process refuses to start without both.

Compose also creates a private, per-install P-256 CA and API leaf certificate on the
`capacitylens-internal-tls` volume before either long-running service starts. Nginx verifies the
`api` service name and CA over TLS 1.2/1.3; the API listener has no plaintext fallback. The CA key
is root-only, the API can read only its own leaf key, and nginx can read only public certificates.
The initializer reuses a valid set and renews the leaf within 30 days of expiry on a coordinated
Compose recreation.

If the browser and API are intentionally on different origins, set
`CAPACITYLENS_CORS_ORIGIN` to the exact comma-separated browser origins. `*` is rejected because
CapacityLens authenticates browser requests with cookies.

Then:

```bash
docker compose up --build -d
docker compose logs -f api
curl -fsS http://127.0.0.1:8080/api/health
```

Put a TLS-terminating reverse proxy or load balancer in front of port 8080. Compose binds that port
to `127.0.0.1` by default; set `WEB_BIND_IP` only when a private platform load balancer must reach
the container host. The public edge must overwrite `X-Forwarded-Proto` with the browser-visible
scheme. If that proxy emits HSTS itself, `CAPACITYLENS_HTTPS` may stay unset; otherwise set it only
when the public response is actually HTTPS. Never expose the API container directly.

The first password owner must enter `CAPACITYLENS_SETUP_TOKEN`. Remove the value from the running
environment after setup if your deployment process permits; it cannot create a second first user.
Complete TOTP enrollment immediately, copy recovery codes to an access-controlled password manager
and verify that a second sign-in is challenged before opening the service to users.

## Production checklist

- `NODE_ENV=production` (the image sets it).
- `CAPACITYLENS_AUTH=password` or `sso`; auth-off production is refused by default.
- Public `BETTER_AUTH_URL` exactly matches the browser origin and uses HTTPS.
- `BETTER_AUTH_SECRET` and setup/provider secrets come from a password manager, not Git.
- `CAPACITYLENS_ALLOW_OPEN_SIGNUP`, `CAPACITYLENS_ALLOW_RESET` and
  `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION` are unset.
- Password mode has `CAPACITYLENS_REQUIRE_MFA=1` and breached-password checking enabled.
- Rate limiting is a positive integer; deep health, structured logging, audit and snapshots are enabled.
- Database/audit/backup storage is encrypted and the corresponding attestation is `1`.
- `CAPACITYLENS_AUDIT_STDOUT=1` is collected off-host/separately, and the security-log-forwarding
  attestation is `1`.
- Database and backup volumes are persistent; backups are copied off-host and restore-tested.
- Proxy overwrites forwarding headers and the API cannot be reached around it.
- The internal certificate initializer succeeds, nginx verifies the API certificate, and neither
  long-running container can read the CA private key.

The complete variable register and defaults are in `.env.example`.

Numeric operational settings accept bounded whole numbers only: rate limiting is at most 1,000,000
requests/minute, backup intervals at most 35,000 minutes, retained snapshots at most 10,000, and
audit rotation at most 1,048,576 MiB. Invalid values fall back to their documented safe defaults in
development. Production refuses a missing, invalid or zero rate limit.

## Experimental SSO/social

Read `docs/authentication.md` first. In password mode, provider buttons are additive. Configure both
id and secret for any provider; partial configuration refuses startup.

For the first external identity, set an explicit allow-list:

```dotenv
CAPACITYLENS_SSO_BOOTSTRAP_EMAILS=owner@example.com
```

Subsequent new identities must match an unused, non-expired pre-authorised invitation. Test the
exact provider in staging. Switch to `CAPACITYLENS_AUTH=sso` only when password recovery is no
longer required, generic OIDC is configured and the IdP requires MFA for every eligible user. SSO
mode refuses production startup until that external policy is acknowledged with
`CAPACITYLENS_SSO_MFA_ENFORCED=1`.

## Bare-metal outline

Use Node 24 and the pinned pnpm version:

```bash
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm run build
```

Run `pnpm --filter capacitylens-server start` as an unprivileged supervised system service with
automatic restart on non-zero exit (the daemon deliberately drains and exits after an uncaught
process fault rather than continuing with potentially corrupt state). Configure
`CAPACITYLENS_HOST=127.0.0.1`, a database path outside the checkout and the same production auth
variables above. Create an internal CA-signed service certificate, set
`CAPACITYLENS_INTERNAL_TLS_CERT` and `CAPACITYLENS_INTERNAL_TLS_KEY`, then configure nginx with
`proxy_pass https://127.0.0.1:8787`, `proxy_ssl_verify on`, the trusted CA, and a matching
`proxy_ssl_name`. Route `/api/` without stripping the prefix and use the security headers in the
repository's `nginx.conf`. Production refuses to start if either identity path is missing or
unreadable; do not add an HTTP fallback upstream.

Do not run the daemon from an interactive shell or store the database inside a directory replaced
by deploys.

### Release-directory deployments

Platforms that build into versioned release directories and switch a stable `current` symlink must
coordinate that switch with the long-running API process. Build the new release while the existing
process continues serving traffic, stop the process immediately before activation and release
cleanup, then restart it from the stable path and verify `/api/health`.

Do not purge a release while a service still has that release as its working directory. Keep the
database, backups, environment file and operational logs outside the release tree so activation and
rollback cannot replace persistent state.

## Upgrades

1. Confirm an off-host backup and a recent restore test.
2. Read `CHANGELOG.md` for migrations or breaking changes.
3. Pull the target tag, rebuild all three targets and use a coordinated recreation so certificate
   renewal, API restart and nginx restart complete together.
4. Check API health, login, account access and one safe write.
5. Keep the old image available until verification completes; never roll back the SQLite file by
   copying it while the server is running.

## Data and offline behavior

The SQLite file is authoritative. The demo is a separate in-memory build. Optional browser offline
access is a seven-day read-only snapshot and does not replace server backups. See
`docs/offline.md`, `docs/privacy.md` and `docs/runbook.md`.
