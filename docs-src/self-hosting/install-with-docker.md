---
title: Install with Docker
description: Install CapacityLens with Docker Compose, from cloning the repository to a running, health-checked instance.
prev:
  text: Choose how to install
  link: /getting-started/install
next:
  text: Configure the service
  link: /installation/configure-the-service
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
  a heavy stack. For a small production installation, start with 1 shared CPU core, at
  least 2 GB RAM and a few GB of disk (more if you keep a lot of backup snapshots).

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

   Set `CAPACITYLENS_STORAGE_ENCRYPTED=1` only after verifying that the host's Docker
   volumes and off-host backup destination use encryption at rest. The setting records
   your attestation; it does not encrypt a volume. `SMALLSASS_ACCOUNT_PUBLIC_URL` must be the exact browser-facing origin. See
   [Configure the service](/installation/configure-the-service) for what every other variable does.

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
   docker compose ps --all
   ```

   ```bash
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

7. Put a TLS-terminating reverse proxy in front of port 8080, then continue to
   [verify and hand over the installation](/installation/verify-and-hand-over).
   See [Secure the connection](/installation/secure-the-connection) for the proxy and
   [Configure the service](/installation/configure-the-service#sign-in-mode) for the
   sign-in settings.

::: tip
Compose binds port 8080 to `127.0.0.1` by default — nothing outside the host can reach
it until you add the reverse proxy in the next page.
:::

## What's next

- [Configure the service](/installation/configure-the-service) to understand every environment variable
  you just set, plus the ones you didn't.
- [Secure the connection](/installation/secure-the-connection) to put a real domain and
  certificate in front of the stack.
- [Try a local demo](/getting-started/try-the-demo) for the disposable, in-memory
  interface. It is separate from this persistent installation.
