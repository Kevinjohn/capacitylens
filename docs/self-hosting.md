# Self-hosting

The supported deployment shape is a same-origin web app and API behind TLS, with SQLite and its
audit log on persistent storage. Scheduled snapshots are optional. Docker Compose is the shortest
path; systemd/nginx works too.

## Requirements

- A host that can run Docker Compose, or Node 24 + nginx.
- A DNS name and TLS certificate for an internet-facing instance.
- Persistent storage for the database, audit log and any enabled snapshots.

Encrypted storage, an off-host backup destination, external log collection and internal proxy/API
TLS are recommended hardening, not prerequisites for a small community deployment.

## Docker Compose

```bash
git clone https://github.com/Kevinjohn/capacitylens.git
cd capacitylens
cp .env.example .env
openssl rand -base64 48  # SMALLSASS_ACCOUNT_SECRET
openssl rand -base64 48  # SMALLSASS_ACCOUNT_SETUP_TOKEN
```

At minimum, edit `.env`:

```dotenv
SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE=self-hosted-password
SMALLSASS_ACCOUNT_MODE=password
SMALLSASS_ACCOUNT_SECRET=<first generated value>
SMALLSASS_ACCOUNT_PUBLIC_URL=https://capacity.example.com
SMALLSASS_ACCOUNT_SETUP_TOKEN=<second generated value>
CAPACITYLENS_HTTPS=1
CAPACITYLENS_RATE_LIMIT=300
```

Password breach screening remains on by default. TOTP MFA is optional; set
`SMALLSASS_ACCOUNT_REQUIRE_MFA=1` when every password user should be required to enroll before accessing
company data.

Compose also creates a private, per-install P-256 CA and API leaf certificate on the
`capacitylens-internal-tls` volume before either long-running service starts. Nginx verifies the
`api` service name and CA over TLS 1.2/1.3; the API listener has no plaintext fallback. The CA key
is root-only, the API can read only its own leaf key, and nginx can read only public certificates.
The initializer reuses a valid set. Run `./scripts/renew-internal-tls.sh` within 30 days of leaf
expiry; it stops both TLS consumers before publication, force-recreates them and verifies their live
generation through nginx before reporting success. Renewal stages files privately on the certificate
volume and publishes them by same-filesystem rename; a still-valid CA is not rewritten during
leaf-only renewal. Deep `/api/health` reports the cached leaf expiry and live certificate fingerprint, and changes its
`internalTls.status` from `ok` to `expiring` during that same 30-day window; alert on that field and
perform the coordinated renewal before expiry.

The Compose project name is pinned to `capacitylens`, so the physical database, backup and
internal-TLS volume names do not change when the checkout directory is renamed. Do not introduce a
different `docker compose -p` or `COMPOSE_PROJECT_NAME` after first start: either override selects a
different set of volumes.

If the browser and API are intentionally on different origins, set
`CAPACITYLENS_CORS_ORIGIN` to the comma-separated HTTP(S) browser origins. Host case, default ports
and a trailing slash are normalized. Credentials, paths, queries, fragments and `*` are rejected at
startup because CapacityLens authenticates browser requests with cookies.

### Client-only Compose image

The normal `web` service is deliberately coupled to the same-origin local API. For an in-memory
demo with no backend, set `VITE_CAPACITYLENS_DEMO=1` and explicitly start the static-only service:

```bash
VITE_CAPACITYLENS_DEMO=1 docker compose up --build -d web-client
curl -fsS http://127.0.0.1:8080/
```

Naming `web-client` is important: it activates only that profile and has no API dependency or
internal-certificate mount. Its healthcheck verifies the SPA root. Data is temporary and resets on
refresh; do not present this mode as persistent scheduling.

To serve the SPA against an API on another origin, leave the demo flag empty, set
`VITE_CAPACITYLENS_API` to that exact HTTP(S) origin and start the same `web-client` service. The
build rejects credentials, paths, queries and fragments, and permits only that origin in the
packaged CSP. The remote API must allow the browser origin through `CAPACITYLENS_CORS_ORIGIN` and
must be configured for the intended browser-cookie topology. The client-only nginx returns 404 for
same-origin `/api/*`; it never silently falls back to an unused local daemon.

For the normal same-origin stack:

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

Loopback API listeners (`127.0.0.1`, `localhost` or `::1`, including the bare-metal configuration
below) automatically trust their same-host proxy's forwarded headers. That proxy must overwrite,
not append, `X-Forwarded-For` and `X-Forwarded-Proto`; otherwise a supplied leftmost value can become
the rate-limit identity or public-origin scheme. `CAPACITYLENS_TRUST_PROXY_HEADERS=1` enables the
same posture on a non-loopback listener and is safe only when clients cannot reach the API directly.
The packaged Compose topology sets it because its API listens on the private container network and
only packaged Nginx can reach it.

The first password owner must enter `SMALLSASS_ACCOUNT_SETUP_TOKEN`. Remove the value from the running
environment after setup if your deployment process permits; it cannot create a second first user.
When required MFA is enabled, complete enrollment immediately, store recovery codes in a password
manager and verify that a second sign-in is challenged before opening the service to users.

## Production checklist

- `NODE_ENV=production` (the image sets it).
- `SMALLSASS_ACCOUNT_MODE=password` or `sso`; auth-off production is refused by default.
- Public `SMALLSASS_ACCOUNT_PUBLIC_URL` exactly matches the browser origin and uses HTTPS.
- `SMALLSASS_ACCOUNT_SECRET` and setup/provider secrets come from a password manager, not Git.
- `SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP`, `CAPACITYLENS_ALLOW_RESET` and
  `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION` are unset.
- Rate limiting is a positive integer; local audit logging remains enabled. Production startup
  refuses `CAPACITYLENS_AUDIT=off` rather than serving without the mutation audit.
- Database and any enabled backup paths are persistent and outside release directories.
- The database and audit JSONL share a persistent failure domain: SQLite retains pending mutation
  events until their fsynced file delivery succeeds, so preserve both files during recovery.
- Proxy overwrites forwarding headers and the API cannot be reached around it.

`CAPACITYLENS_ALLOW_RESET=1` exposes the installation-wide test reset only while authentication is
off, and production startup still refuses the flag. It is E2E/local tooling, not an administrative
recovery mechanism; authenticated modes return 403 because tenant membership grants no global wipe
authority.

Recommended hardening, deliberately optional for community self-hosting:

- Set `SMALLSASS_ACCOUNT_REQUIRE_MFA=1` to require TOTP for password users.
- Leave breached-password checking enabled; isolated/offline deployments may set
  `SMALLSASS_ACCOUNT_PASSWORD_BREACH_CHECK=off` and accept the startup warning.
- Put the database, audit log and backups on encrypted storage, then—and only then—set
  `CAPACITYLENS_STORAGE_ENCRYPTED=1` to record that operator attestation.
- Copy backups off-host and restore-test them. The application also works with local snapshots only,
  or with `CAPACITYLENS_BACKUP_DIR=` to disable scheduled snapshots.
- Set `CAPACITYLENS_AUDIT_STDOUT=1`, forward `capacitylens.audit` and `capacitylens.security` events
  to a separate collector, then set `CAPACITYLENS_SECURITY_LOG_FORWARDING=1`.
- For Compose, verify the automatic internal certificate initializer and nginx service-name check.
  For bare metal, optionally configure the same internal TLS pattern described below.

This recommended hardened configuration is exactly what CI exercises: the blocking OWASP ZAP
baseline boots a Compose stack with authentication, required MFA, scheduled backups and both
attestations enabled and scans it on every change, so enabling the hardening means running the
continuously tested posture. The out-of-the-box default is scanned separately each week as a
non-blocking report of its accepted residual surface.

Missing optional hardening produces explicit production posture warnings, not startup refusal. The
attestation variables report external controls; they never implement encryption, backups or log
delivery themselves.

The complete variable register and defaults are in `.env.example`.

Numeric operational settings accept bounded whole numbers only: rate limiting is at most 1,000,000
requests/minute, backup intervals at most 35,000 minutes, retained snapshots at most 10,000, and
audit rotation at most 1,048,576 MiB. Invalid or lower backup values fall back to their documented
safe defaults; over-maximum backup values clamp to their published maximum with a startup warning.
Production refuses a missing, invalid or zero rate limit.

## Strict OIDC and experimental social providers

Read `docs/authentication.md` first. In password mode, provider buttons are additive. Configure both
id and secret for any provider; partial configuration refuses startup.

For the first external identity, set an explicit allow-list:

```dotenv
SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE=self-hosted-sso-only
SMALLSASS_ACCOUNT_MODE=sso
SMALLSASS_ACCOUNT_OIDC_CLIENT_ID=capacitylens
SMALLSASS_ACCOUNT_OIDC_CLIENT_SECRET=<secret-manager value>
SMALLSASS_ACCOUNT_OIDC_ISSUER=https://identity.example.com
SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL=https://identity.example.com/.well-known/openid-configuration
SMALLSASS_ACCOUNT_OIDC_BOOTSTRAP_EMAILS=owner@example.com
```

Subsequent new identities must match an unused, non-expired pre-authorised invitation. Test the
exact IdP in staging. The issuer and discovery URL are both mandatory, the `openid` scope cannot be
removed, and explicit authorization/token endpoint overrides are rejected. Use
`self-hosted-mixed` with password mode only when a local password fallback is a deliberate
self-hosted choice. Requiring MFA at the IdP remains strongly recommended; after testing that
policy and its recovery path, set `SMALLSASS_ACCOUNT_SSO_MFA_ENFORCED=1`. Named Google, Microsoft
and GitHub providers remain experimental; strict OIDC is the supported provider-neutral path.
The compatibility register also recognises `SMALLSASS_ACCOUNT_OIDC_AUTHORIZATION_URL` and
`SMALLSASS_ACCOUNT_OIDC_TOKEN_URL`, but named profiles reject both; they are not supported
self-hosting configuration.
After the first successful startup, the configured generic provider id and issuer are an immutable
pair. Changing either side refuses startup to protect existing `(issuer, subject)` correlations;
plan an explicit reviewed identity migration instead of editing those values in place.

### Converting an existing password installation to SSO

Use `self-hosted-mixed` as the staging posture. Every existing member must connect the configured
strict-OIDC identity from their own fresh password session; administrators can see installation
readiness and repair local email or wrong-subject mistakes from Team & access. Then run:

```bash
pnpm --filter capacitylens-server cutover:preflight -- /absolute/path/to/capacitylens.db
```

Do not proceed on a non-zero exit. When it passes, stop traffic, set
`SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE=self-hosted-sso-only` and
`SMALLSASS_ACCOUNT_MODE=sso`, then restart. The server revokes all sessions and outstanding
verification/reset ceremonies, durably records the first activation, and reruns the all-company
readiness interlock before listening. Live reset ceremonies are reported and revoked rather than
blocking that revocation; expired verification rows are ignored. SSO-only refuses open signup;
experimental named social providers remain available to existing principals when configured but
cannot admit a new local principal. New invitations must pre-authorise an email and be accepted
through the strict provider. Retained credentials make rollback possible only by
reverting to mixed mode and restarting.
The complete operating and repair procedure is in `docs/runbook.md` under “Password-to-SSO cutover”.

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
process fault rather than continuing with potentially corrupt state). Graceful shutdown allows ten
seconds for accepted requests and background snapshots to drain, then force-exits non-zero; keep a
supervisor kill grace above ten seconds (the supplied Compose configuration uses fifteen). Configure
`CAPACITYLENS_HOST=127.0.0.1`, a database path outside the checkout and the same production auth
variables above. A simple same-host Forge/nginx deployment may omit both internal TLS variables and
use `proxy_pass http://127.0.0.1:8787`; keep the API bound to loopback and terminate public HTTPS at
nginx. Route `/api/` without stripping the prefix, overwrite both forwarded headers as the supplied
`nginx.conf` does, and use its security headers.

For defense in depth, create an internal CA-signed service certificate, set both
`CAPACITYLENS_INTERNAL_TLS_CERT` and `CAPACITYLENS_INTERNAL_TLS_KEY`, then switch nginx to
`proxy_pass https://127.0.0.1:8787` with `proxy_ssl_verify on`, the trusted CA and a matching
`proxy_ssl_name`. Once either identity path is configured, a partial, empty or unreadable pair still
refuses startup; there is never a silent fallback from a requested HTTPS identity to HTTP.

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

One-time compatibility check for a Compose deployment created before the project name was pinned:
before pulling the new Compose file, identify the database volume attached to the running API.

```bash
db_volume="$(docker inspect "$(docker compose ps -q api)" \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')"
printf 'Database volume: %s\n' "$db_volume"
```

If that name is not `capacitylens_capacitylens-db`, take the prefix before
`_capacitylens-db` and add it to the existing `.env`, for example
`COMPOSE_PROJECT_NAME=floaty-v1`. Keep that override for the lifetime of the install. After pulling,
run `docker compose config` and confirm its three rendered physical volume names carry the same
historical prefix before starting any service. If more than one candidate prefix exists, stop and
identify the volume mounted by the old API rather than guessing.

1. Take a fresh explicit snapshot and preserve it outside the release tree. A recent restore test
   proves the procedure, but is not a current copy of the live data; off-host copies remain
   recommended for disaster recovery.
2. Confirm a recent restore test.
3. Read `CHANGELOG.md` for migrations or breaking changes.
4. Pull the target tag, rebuild all three targets and stop the old API before activating the new
   one. Compose deployments use `docker compose up --build --force-recreate -d`; this reruns the
   certificate initializer and reloads the resulting identity into both long-running services.
   Mixed-version writers are unsupported.
5. On first start, any pending database upgrade creates a verified
   `capacitylens-pre-migration-vN-to-vM.db` snapshot before DDL. If this fails, startup refuses;
   resolve storage or permission capacity rather than bypassing the snapshot.
6. Check API health, login, account access and one safe write.
7. Keep the old image and recovery snapshot until verification completes. Rollback means stopping
   the API, restoring the pre-migration snapshot when this release created one, or otherwise the
   explicit snapshot from step 1, without stale WAL/SHM files, then starting the old image. An old
   image deliberately refuses an upgraded database. For Compose's named volumes, follow the
   executable restore procedure in `docs/runbook.md` rather than copying host paths.

## Data and offline behavior

The SQLite file is authoritative. The demo is a separate in-memory build. Optional browser offline
access is a seven-day read-only snapshot and does not replace server backups. See
`docs/offline.md`, `docs/privacy.md` and `docs/runbook.md`.

While a server-backed tab is visible, it refreshes the active company at least once per minute;
returning focus may refresh sooner and is throttled to once per 30 seconds. A refresh first flushes
pending edits and is postponed while a save is failing, so it cannot silently discard unsaved work.
Write conflicts still resolve from the authoritative server copy and surface the rejected local edit.
