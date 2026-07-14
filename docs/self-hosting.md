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
```

Then:

```bash
docker compose up --build -d
docker compose logs -f api
curl -fsS http://127.0.0.1:8080/api/health
```

Put a TLS-terminating reverse proxy or load balancer in front of port 8080. If that proxy emits
HSTS itself, `CAPACITYLENS_HTTPS` may stay unset; otherwise set it only when the public response is
actually HTTPS. Never expose the API container directly.

The first password owner must enter `CAPACITYLENS_SETUP_TOKEN`. Remove the value from the running
environment after setup if your deployment process permits; it cannot create a second first user.

## Production checklist

- `NODE_ENV=production` (the image sets it).
- `CAPACITYLENS_AUTH=password` or `sso`; auth-off production is refused by default.
- Public `BETTER_AUTH_URL` exactly matches the browser origin and uses HTTPS.
- `BETTER_AUTH_SECRET` and setup/provider secrets come from a password manager, not Git.
- `CAPACITYLENS_ALLOW_OPEN_SIGNUP`, `CAPACITYLENS_ALLOW_RESET` and
  `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION` are unset.
- Rate limiting, deep health, structured logging, audit and snapshots are enabled.
- Database and backup volumes are persistent; backups are copied off-host and restore-tested.
- Proxy overwrites forwarding headers and the API cannot be reached around it.

The complete variable register and defaults are in `.env.example`.

## Experimental SSO/social

Read `docs/authentication.md` first. In password mode, provider buttons are additive. Configure both
id and secret for any provider; partial configuration refuses startup.

For the first external identity, set an explicit allow-list:

```dotenv
CAPACITYLENS_SSO_BOOTSTRAP_EMAILS=owner@example.com
```

Subsequent new identities must match an unused, non-expired pre-authorised invitation. Test the
exact provider in staging. Switch to `CAPACITYLENS_AUTH=sso` only when password recovery is no
longer required and generic OIDC is configured.

## Bare-metal outline

Use Node 24 and the pinned pnpm version:

```bash
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm run build
```

Run `pnpm --filter capacitylens-server start` as an unprivileged system service with
`CAPACITYLENS_HOST=127.0.0.1`, a database path outside the checkout and the same production auth
variables above. Serve `dist/` with nginx, route `/api/` to `127.0.0.1:8787` without stripping the
`/api` prefix, and use the security headers in the repository's `nginx.conf`.

Do not run the daemon from an interactive shell or store the database inside a directory replaced
by deploys.

## Upgrades

1. Confirm an off-host backup and a recent restore test.
2. Read `CHANGELOG.md` for migrations or breaking changes.
3. Pull the target tag, rebuild both images and start them.
4. Check API health, login, account access and one safe write.
5. Keep the old image available until verification completes; never roll back the SQLite file by
   copying it while the server is running.

## Data and offline behavior

The SQLite file is authoritative. The demo is a separate in-memory build. Optional browser offline
access is a seven-day read-only snapshot and does not replace server backups. See
`docs/offline.md`, `docs/privacy.md` and `docs/runbook.md`.
