---
title: Choose how to install CapacityLens
description: Choose Docker Compose, a direct Node installation, or a managed VPS platform for CapacityLens.
---

# Choose how to install CapacityLens

CapacityLens has three supported installation routes. Docker is not a prerequisite: use
Docker Compose if you want CapacityLens to manage the packaged services, install it
directly if you manage Node and nginx yourself, or adapt the direct installation for a
managed VPS platform.

Every route gives you the same persistent CapacityLens app, SQLite database and sign-in
options. Each also takes you through creating the first [Owner](/reference/glossary)
account. The difference is how the app and API run on your host.

::: tip
Just want to look around first? [Try the demo](/getting-started/try-the-demo) instead —
no persistent data or sign-in setup required.
:::

## Install with Docker

Choose [Install with Docker](/self-hosting/install-with-docker) if your host already
runs Docker and Docker Compose. The packaged stack builds and runs the web app, API and
their internal certificate setup for you.

You will need Docker, Docker Compose and a reverse proxy for public TLS. Allow about ten
minutes on a host where Docker is already installed.

## Install without Docker

Choose [Install without Docker](/self-hosting/install-without-docker) if you do not use
Docker or prefer to manage the services on the host. Node 24 runs the API as a systemd
service, while nginx serves the web app and sends API requests to Node.

You will need a Linux host with systemd, Node 24, pnpm and nginx. Allow about 20–30
minutes when those tools are already installed.

## Deploy on a managed VPS platform

Choose [Deploy on a managed VPS platform](/self-hosting/managed-vps/) if Forge, Ploi,
RunCloud or a similar service manages nginx, background processes and release directories
on your server. CapacityLens still runs directly on Node; the platform replaces the
systemd and hand-written site-management steps.

You will need a managed Linux server with Node 24, Corepack, an isolated site user and a
public HTTPS domain. Allow about an hour for the first installation and its operational
checks.

## What's next

After completing a route, follow [First steps after installing](/getting-started/first-steps)
to claim the Owner account and find your way around the schedule.
