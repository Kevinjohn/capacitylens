---
title: Install with Docker
description: Install CapacityLens with Docker Compose, from cloning the repository to a running, health-checked instance.
---

# Install with Docker

This is the shortest path to a running CapacityLens instance: one Docker Compose stack
with the web app, the API and an automatic internal certificate, backed by SQLite on
persistent volumes. It takes about ten minutes on a host that already has Docker
installed, most of it waiting for the first build.

## Prerequisites

- A host that can run Docker and Docker Compose. See
  [Docker's install instructions](https://docs.docker.com/engine/install/) for your OS.
- Read [Before you start](/self-hosting/) if you haven't already.
- **Architecture**: the packaged images are built from multi-architecture base images
  (`node`, `alpine`, `nginx-unprivileged`), which publish both `linux/amd64` and
  `linux/arm64`. CapacityLens itself is tested on x86-64; arm64 (including Apple
  Silicon and AWS Graviton hosts) should work but isn't independently tested — open an
  issue if you hit something arm64-specific.
- **Resources**: this is a small Node API and a static file server backed by SQLite, not
  a heavy stack. As rough guidance: 1 CPU core, 1 GB RAM and a few GB of disk (more if
  you keep a lot of backup snapshots) is enough for a single small team.

## Steps

1. Clone the repository and copy the example environment file:

   ```bash
   git clone https://github.com/Kevinjohn/capacitylens.git
   cd capacitylens
   cp .env.example .env
   ```

2. Generate two secrets — one for signing sessions, one for the first-owner setup
   token:

   ```bash
   openssl rand -base64 48
   ```

   Run it twice and keep both values; you'll paste one into each of the two secret
   fields in the next step.

3. Open `.env` and set at least these values:

   ```dotenv
   SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE=self-hosted-password
   SMALLSASS_ACCOUNT_MODE=password
   SMALLSASS_ACCOUNT_SECRET=<first generated value>
   SMALLSASS_ACCOUNT_PUBLIC_URL=https://capacity.example.com
   SMALLSASS_ACCOUNT_SETUP_TOKEN=<second generated value>
   CAPACITYLENS_HTTPS=1
   CAPACITYLENS_RATE_LIMIT=300
   ```

   `SMALLSASS_ACCOUNT_PUBLIC_URL` must be the exact browser-facing origin. See
   [Configuration](/self-hosting/configuration) for what every other variable does.

4. Build and start the stack:

   ```bash
   docker compose up --build -d
   ```

   This also builds the `internal-tls` one-off service, which creates a private
   certificate authority and API certificate before the API or web service starts.

5. Watch the API come up:

   ```bash
   docker compose logs -f api
   ```

   Press `Ctrl-C` to stop following once the log settles — the API doesn't print a
   single "ready" line, so a quiet log with no restart is what you're looking for.

6. Check the app is serving and the API is healthy:

   ```bash
   docker compose ps
   curl -fsS http://127.0.0.1:8080/api/health
   ```

   Expected output is a JSON object starting `{"ok":true,...}`. With the packaged
   defaults, deep health is on, so you'll also see `db`, `audit`, `auditPending`,
   `backup` and `internalTls` fields — see
   [Monitoring and health checks](/self-hosting/monitoring) for what each one means.

   In the `docker compose ps` output, `internal-tls` showing `Exited (0)` is expected —
   it's a one-shot job that creates the internal certificate and then exits
   successfully; it isn't meant to keep running. See
   [Monitoring and health checks](/self-hosting/monitoring) for how to check the
   certificate it created.

7. Put a TLS-terminating reverse proxy in front of port 8080 and finish sign-in setup.
   See [TLS and networking](/self-hosting/tls-and-networking) for the proxy, then enter
   `SMALLSASS_ACCOUNT_SETUP_TOKEN` as the first owner when you open the app through your
   domain.

::: tip
Compose binds port 8080 to `127.0.0.1` by default — nothing outside the host can reach
it until you add the reverse proxy in the next page.
:::

## A demo-only, no-backend image

If you just want to try the interface with no database and no sign-in, build the
client-only image instead:

```bash
VITE_CAPACITYLENS_DEMO=1 docker compose up --build -d web-client
curl -fsS http://127.0.0.1:8080/
```

Naming `web-client` explicitly is what matters — it starts only that service, with no
API dependency and no certificate volume. Data resets on every page refresh; this mode
is not a persistent installation.

::: warning
`web-client` binds the same `127.0.0.1:8080` port as the real `web` service from the
steps above. Don't run both on the same host at once — the second one to start will
fail to bind the port, or worse, you'll end up unsure which one you're looking at. Give
the demo its own port with `WEB_PORT`:

```bash
WEB_PORT=8081 VITE_CAPACITYLENS_DEMO=1 docker compose up --build -d web-client
curl -fsS http://127.0.0.1:8081/
```
:::

## What's next

- [Configuration](/self-hosting/configuration) to understand every environment variable
  you just set, plus the ones you didn't.
- [TLS and networking](/self-hosting/tls-and-networking) to put a real domain and
  certificate in front of the stack.
