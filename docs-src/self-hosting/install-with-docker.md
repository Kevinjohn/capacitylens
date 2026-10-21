---
title: Install with Docker
description: Build the API and web images and keep the database in persistent Compose volumes.
---

# Install with Docker

Use Docker Compose on a Linux host with a public HTTPS proxy. The web container serves the app
and forwards API requests over the private Compose network. Public HTTPS terminates at your
edge proxy; there is no internal certificate authority.

## Configure the instance

Download the source for the release you intend to run. Copy `.env.example` to `.env`, keep it
private, and fill in `APP_KEY`, `CAPACITYLENS_SECRET`, `CAPACITYLENS_SETUP_TOKEN` and
`CAPACITYLENS_PUBLIC_URL`. Generate independent random values of at least 32 characters for the
three secrets. Password sign-in is enabled by default. Keep open production access disabled.

The published port binds to loopback by default. Configure your HTTPS proxy to forward to
`127.0.0.1:8080`; see [TLS and networking](/self-hosting/tls-and-networking). Change `WEB_PORT`
only when another service already uses that port.

## Build and start

```bash
docker compose up --build --detach --wait
```

Compose runs `app:upgrade` as a separate, one-shot service before starting the API. It creates a
fresh database, or backs up an existing database and runs pending migrations. Do not copy a database from the retired server into the current volume.

Open your public address, use the setup token to create the first sign-in, and create your company.
Check `/health/ready` through the public address before handing the service over.

## Preserve and recover data

The project name remains `capacitylens`. The `capacitylens-db` and `capacitylens-backups` volumes
hold the database and snapshots. Ordinary container recreation preserves both. Never use
`docker compose down --volumes` on an instance whose data you need.

For an upgrade, stop the running stack before building and starting the new release. The
one-shot upgrade must finish before the API opens the database. Keep an independent copy of the
volumes and follow [Backups and restore](/self-hosting/backups-and-restore).

Use `docker compose logs upgrade api` to inspect startup failures. Secret values and recovery
links must stay private. [Incidents](/self-hosting/incidents) explains stopped-server recovery.
