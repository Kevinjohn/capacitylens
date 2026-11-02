---
title: Install with Docker
description: Build the API and web images and keep the database in persistent Compose volumes.
---

# Install with Docker

The supplied Compose stack uses separate web and API containers and sends API requests across the
private Compose network. This topology has not been validated for production; its separate-container
proxy makes all clients share one request-limit budget. The supported proxy runs on the application
host and connects over loopback, preserving forwarded client addresses. For a directly supported
production installation, use the [native release archive](/self-hosting/install-without-docker).

Use Docker Compose on a Linux host with a public HTTPS proxy. The web container serves the app
and forwards API requests over the private Compose network. Public HTTPS terminates at your
edge proxy; there is no internal certificate authority.

## Configure the instance

Download the source for the release you intend to run. Copy `.env.example` to `.env`, keep it
private, and fill in `APP_KEY`, `CAPACITYLENS_SECRET` and the HTTPS `CAPACITYLENS_PUBLIC_URL`.
Generate independent random values of at least 32 characters for both secrets. Fill in the
`CAPACITYLENS_MAIL_*` settings: invitations and password resets are emailed.

The published port binds to loopback by default. Configure your HTTPS proxy to forward to
`127.0.0.1:8080`; see [TLS and networking](/self-hosting/tls-and-networking). Change `WEB_PORT`
only when another service already uses that port.

## Build and start

The Node base image comes from Docker Hub and remains pinned by digest. GitHub-hosted runners
are [exempt from its public-image pull limit](https://docs.github.com/en/actions/reference/limits#docker-hubs-rate-limit-for-github-actions).
Local and self-hosted runners remain subject to [Docker Hub pull limits](https://docs.docker.com/docker-hub/usage/pulls/);
use `docker login` with your own account if your host reaches that limit.

```bash
docker compose up --build --detach --wait
```

Compose runs `app:upgrade` as a separate, one-shot service before starting the API. It creates a
fresh database, or backs up an existing database and runs pending migrations. Do not copy a database from the retired server into the current volume.

Print the one-time setup link for the first person, open it, choose a password and create your
company:

```bash
docker compose exec api node ace.js account-kit:admission:bootstrap owner@example.com --role=viewer
```

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
