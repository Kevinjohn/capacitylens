---
title: Deploy on a managed host
description: Run a built CapacityLens clone on a managed Linux host with a persistent data directory and HTTPS proxy.
---

# Deploy on a managed host

Use a managed host that lets you run a persistent Node process as a dedicated site user. Labels
vary by provider; the requirements are the same: Node 24.19.0 or later within the 24.x line, one process,
a writable data directory outside the clone, and an HTTPS reverse proxy.

## Prepare the host

Create a private data directory owned by the service user. Clone the repository at a release tag
into `/opt/capacitylens`, then install and build as described in
[Install without Docker](/self-hosting/install-without-docker). Keep this folder layout stable
across releases:

```text
/opt/capacitylens/apps/backend/build/
/var/lib/capacitylens/capacitylens.db
/var/lib/capacitylens/backups/
/etc/capacitylens.env
```

Follow [Install without Docker](/self-hosting/install-without-docker) for the exact directory,
permissions, key generation and initial `app:upgrade` command.

## Configure the process

Copy `packaging/release/capacitylens.env.example` to a root-owned environment file outside the clone. Set
`APP_URL` and `CAPACITYLENS_PUBLIC_URL` to the public HTTPS origin, keep `CAPACITYLENS_DB` and
`CAPACITYLENS_BACKUP_DIR` under the persistent data folder, and set independent secret values.
Configure the host's process manager to:

- run as the dedicated site user from `apps/backend/build`;
- execute `node bin/server.js` with `NODE_ENV=production` and the private environment file;
- run exactly one application process and allow graceful shutdown;
- restart after an unexpected failure.

The repository's `packaging/release/capacitylens.service` is a systemd example. The application serves the web app and
API from the same process. Do not add a second server or public listener for the API.

## Route HTTPS traffic

Terminate public TLS at the platform proxy or a Caddy/nginx service on the same machine. A proxy
in another container or on another machine is not yet supported. Forward requests to
the loopback listener and overwrite forwarded host, address and scheme headers at that trusted
boundary. Do not expose the application port directly. See [TLS and networking](/self-hosting/tls-and-networking).

## First start and handover

With the service stopped, run `node ace.js app:upgrade` from `current/backend` under the same
environment. Start the service, check `/health/ready`, then print the one-time setup link with
`node ace.js account-kit:admission:bootstrap <owner-email> --role=viewer` under the same
environment. Open the link, choose a password, and enter the company name to become Owner and open
Schedule. No company command or restart is needed. The server blocks additional open sign-up until
the first company exists, even when enabled in configuration. Configure mail delivery before
handover: invitations and password resets are emailed.

Before handover, prove the service restarts cleanly, confirm a scheduled backup exists, and give
whoever will maintain hosting the [backup](/self-hosting/backups-and-restore), [upgrade](/self-hosting/upgrades),
[monitoring](/self-hosting/monitoring) and [incident](/self-hosting/incidents) procedures.
