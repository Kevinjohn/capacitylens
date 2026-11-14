---
title: Install with Docker
description: Run the published API and web images with Docker Compose, with optional HTTPS, and keep the database in persistent volumes.
---

# Install with Docker

Each release publishes an API image and a web image to GitHub Container Registry. The supplied
Compose file runs them as separate containers and sends API requests across the private Compose
network. The API trusts forwarded client addresses from that network
(`CAPACITYLENS_TRUST_PROXY_HEADERS=private`), so each client keeps its own request limits. Docker is
optional; the [native release archive](/self-hosting/install-without-docker) remains the expected
installation.

Use Docker Compose on a Linux host. You do not need the source code or a build. The published
images are built for 64-bit x86 (`linux/amd64`); on another architecture,
[build the images yourself](#build-the-images-yourself).

## Configure the instance

Download the Compose file and the example environment file for the release you intend to run,
replacing `X.Y.Z` with its version:

```bash
mkdir capacitylens && cd capacitylens
curl -fsSLO https://raw.githubusercontent.com/Kevinjohn/capacitylens/vX.Y.Z/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/Kevinjohn/capacitylens/vX.Y.Z/.env.example
```

Keep `.env` private and fill in:

- `CAPACITYLENS_VERSION`: the release to run, for example `X.Y.Z`. Compose stops without it.
- `APP_KEY`: a random value of at least 32 characters.
- `CAPACITYLENS_PUBLIC_URL`: the public HTTPS address.
- The `CAPACITYLENS_MAIL_*` settings: invitations and password resets are emailed.

## Choose how HTTPS is served

**Compose serves HTTPS.** Start the stack with the `caddy` profile. Caddy listens on ports 80 and
443, obtains and renews a certificate for the host in `CAPACITYLENS_PUBLIC_URL`, and forwards to
the web container. The host's DNS record must point at this machine and both ports must be
reachable from the internet. Certificates are kept in the `capacitylens-caddy-data` volume.

```bash
docker compose --profile caddy up --detach --wait
```

Use the same `--profile caddy` option on every later `docker compose` command for this instance.

**An existing proxy serves HTTPS.** Start the stack without the profile. The published port binds
to loopback by default; configure your HTTPS proxy to forward to `127.0.0.1:8080`, as described in
[TLS and networking](/self-hosting/tls-and-networking). Change `WEB_PORT` only when another service
already uses that port.

```bash
docker compose up --detach --wait
```

Set `WEB_BIND_IP` to a private address only for a load balancer that overwrites
`X-Forwarded-For`, and firewall that address so nothing else can reach it. The web container and
the API take the client address from private-network peers, so any other host that reaches the port
can choose the address its requests are limited by.

## First start

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

## Upgrade

Stop the running stack, download the new release's `docker-compose.yml`, set
`CAPACITYLENS_VERSION` in `.env` to the new version, and start the stack again with the command you
chose above. The one-shot upgrade must finish before the API opens the database. Keep an
independent copy of the volumes and follow [Backups and restore](/self-hosting/backups-and-restore).

Use `docker compose logs upgrade api` to inspect startup failures. Secret values and recovery
links must stay private. [Incidents](/self-hosting/incidents) explains stopped-server recovery.

## Build the images yourself

To build from source instead of using the published images, check out the release and add
`--build`. `CAPACITYLENS_VERSION` then only names the images on your host.

```bash
docker compose up --build --detach --wait
```

The Node base image comes from Docker Hub and remains pinned by digest. GitHub-hosted runners
are [exempt from its public-image pull limit](https://docs.github.com/en/actions/reference/limits#docker-hubs-rate-limit-for-github-actions).
Local and self-hosted runners remain subject to [Docker Hub pull limits](https://docs.docker.com/docker-hub/usage/pulls/);
use `docker login` with your own account if your host reaches that limit.
