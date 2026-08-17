---
title: Before you start
description: What you need to self-host CapacityLens, how the pieces fit together, and which page in this section covers which job.
---

# Before you start

CapacityLens runs as a small web app and API behind TLS, storing everything in a single
SQLite file. This page explains what to have ready before you install it, how the moving
parts fit together, and which page to read next for the job in front of you.

## Choose an installation route

CapacityLens supports two ways to install. Choose the route that matches how you manage
your host:

- [Install with Docker](/self-hosting/install-with-docker) requires Docker and Docker
  Compose. The packaged stack manages the web app and API services.
- [Install without Docker](/self-hosting/install-without-docker) requires Node 24, pnpm,
  systemd and nginx. You manage the web app and API services directly.

Docker is not a shared prerequisite. Each installation page lists only what its route
needs.

Whichever route you choose, you also need a domain name and a TLS certificate if the
instance is reachable from the internet. You need persistent storage for the database,
the audit log and, if you turn them on, scheduled backups.

An internet-facing production instance takes longer than a local installation, mostly
because of DNS and certificates.

## The moving parts

A CapacityLens deployment is three pieces:

- **The web app** — the built single-page app, served as static files. In the Docker
  image, nginx serves it and reverse-proxies API calls.
- **The server** — a Node API that handles sign-in, reads and writes. It's the only
  thing that talks to the database.
- **SQLite** — one file on disk is the source of truth for every company, person,
  project and allocation. There's no separate database server to run.

The web app and the server are meant to live behind the same public origin, with TLS
terminated in front of them. See [TLS and networking](/self-hosting/tls-and-networking)
for the exact topology.

## Common questions

**How big does the SQLite file get?** The database itself stays small — it holds
companies, people, projects and allocations, which are a few thousand rows even for a
large team, not raw event data. The part that actually grows over time is the audit log
(every product-data change, written as JSONL); see the `CAPACITYLENS_AUDIT_MAX_MB`
entry in [Configuration](/self-hosting/configuration#the-database-and-backups) for how
it's capped and rotated. Watch disk space as routine maintenance either way — see
[Monitoring and health checks](/self-hosting/monitoring).

**How do I move to a new host?** Take a backup on the old host, restore it on the new
one, then repoint DNS at the new host once you've verified sign-in and the account list.
Don't duplicate the steps here — follow
[Backups and restore](/self-hosting/backups-and-restore) for both halves of that move.

**How do I uninstall completely?** For a Docker Compose install, stop the stack and
remove its containers and named volumes:

```bash
docker compose down
docker volume rm capacitylens_capacitylens-db capacitylens_capacitylens-backups capacitylens_capacitylens-internal-tls
```

Adjust the `capacitylens_` prefix if `docker compose config` shows a different one for
your install (see the historical-prefix note in
[Upgrades](/self-hosting/upgrades#one-time-check-for-older-compose-installations)).
That removes the database, the audit log, scheduled backups and the internal
certificate — there is nothing else CapacityLens writes outside those volumes and the
checkout directory itself, which you can delete once you've confirmed you don't need
it.

## What's next

- Installing for the first time: choose [Install with Docker](/self-hosting/install-with-docker)
  or [Install without Docker](/self-hosting/install-without-docker).
- Choosing sign-in mode, secrets and other environment variables:
  [Configuration](/self-hosting/configuration).
- Putting a domain and certificate in front of it:
  [TLS and networking](/self-hosting/tls-and-networking).
- Protecting your data once it's running:
  [Backups and restore](/self-hosting/backups-and-restore).
- Moving to a new release: [Upgrades](/self-hosting/upgrades).
- Watching a running instance: [Monitoring and health checks](/self-hosting/monitoring).
- Something looks wrong right now: [When something goes wrong](/self-hosting/incidents).
