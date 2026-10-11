---
title: Install with Docker
description: The five install steps with Docker Compose, from cloning the repository to a running, health-checked instance.
prev:
  text: Install CapacityLens
  link: /self-hosting/install
next:
  text: Configuration
  link: /self-hosting/configuration
---

# Install with Docker

The [five install steps](/self-hosting/install) with Docker Compose: one stack runs the web app,
the API and an internal certificate, with SQLite on persistent volumes. About ten minutes on a
host that already has Docker, mostly the first build.

You need:

- A host that can run Docker and Docker Compose. See
  [Docker's install instructions](https://docs.docker.com/engine/install/).
- `linux/amd64` or `linux/arm64`. CapacityLens is tested on x86-64; arm64 (including Apple
  Silicon and AWS Graviton) should work but isn't tested.
- For a small production installation, at least 1 shared CPU core, 2 GB RAM and a few GB of disk
  (more if you keep many backup snapshots).

## 1. Download

Clone the repository, check out the release you're deploying and copy the example environment
file:

```bash
git clone https://github.com/Kevinjohn/capacitylens.git
cd capacitylens
git checkout vX.Y.Z
cp .env.example .env
chmod 600 .env
```

Replace `vX.Y.Z` with the release tag from the
[releases page](https://github.com/Kevinjohn/capacitylens/releases/latest). Don't deploy `main`:
it carries unreleased changes. `chmod 600` keeps the secrets in `.env` readable only by you.

## 2. Pick a folder for the data

Nothing to do: Compose keeps the database, audit log and backups in named volumes. Keep them and
the off-host backup destination on storage encrypted at rest; CapacityLens does not encrypt a
volume itself.

## 3. Configure

Generate the session secret and the first-Owner setup token with `init`. This builds the API
image first:

```bash
docker compose run --rm --no-deps api node dist/index.mjs init --public-url https://capacity.example.com --db /data/capacitylens.db
```

Keep the `CAPACITYLENS_SECRET` and `CAPACITYLENS_SETUP_TOKEN` values it prints. Compose already
sets `NODE_ENV` and `CAPACITYLENS_DB`. Open `.env` and set at least these values:

```dotenv
CAPACITYLENS_DEPLOYMENT_PROFILE=self-hosted-password
CAPACITYLENS_MODE=password-only
CAPACITYLENS_SECRET=<generated CAPACITYLENS_SECRET>
CAPACITYLENS_PUBLIC_URL=https://capacity.example.com
CAPACITYLENS_SETUP_TOKEN=<generated CAPACITYLENS_SETUP_TOKEN>
CAPACITYLENS_HTTPS=1
CAPACITYLENS_RATE_LIMIT=300
```

`CAPACITYLENS_PUBLIC_URL` must be the exact browser-facing origin. The `self-hosted-password`
profile refuses to start with company login or account email settings: remove that line, or change
it as [Configuration](/self-hosting/configuration#company-login) describes, before you add either.
[Configuration](/self-hosting/configuration) covers every other variable.

## 4. Start it

Build and start the stack. This also builds the one-off `internal-tls` service, which creates a
private certificate authority and API certificate before the API or web service starts:

```bash
docker compose up --build -d
```

Watch the API come up:

```bash
docker compose logs -f api
```

Wait for `capacitylens-server listening on ...`, then press `Ctrl-C`. That line does not show
that backups or the audit sink are healthy, so check the app and the API:

```bash
docker compose ps --all
```

```bash
curl -fsS http://127.0.0.1:8080/api/health
```

Expect `{"ok":true,...}` with `db`, `audit`, `auditPending`, `backup` and `internalTls`;
[Monitoring and health checks](/self-hosting/monitoring) explains each. `internal-tls` showing
`Exited (0)` is expected: it is a one-shot job.

Compose binds port 8080 to `127.0.0.1`, so nothing outside the host can reach it until you put a
TLS-terminating reverse proxy in front: see [TLS and networking](/self-hosting/tls-and-networking).

## 5. Open the address

Open the public HTTPS address and check the first-Owner screen loads. If you are also the Owner,
continue with [Set up your company](/owner/) and enter the setup token from step 3. Otherwise,
send the address to the Owner, and send the setup token separately and privately.

Once the Owner can sign in, remove `CAPACITYLENS_SETUP_TOKEN` from `.env` and run
`docker compose up -d --force-recreate api` to discard it from the running container.
[Configuration](/self-hosting/configuration#sign-in-mode) covers sign-in settings.

Next: [Verify and hand over](/self-hosting/verify-and-hand-over) — check health and hand over.
