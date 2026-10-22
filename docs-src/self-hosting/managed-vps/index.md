---
title: Deploy on a managed host
description: Run the native CapacityLens archive on a managed Linux host with a persistent data directory and HTTPS proxy.
---

# Deploy on a managed host

Use a managed host that lets you run a persistent Node process as a dedicated site user. Labels
vary by provider; the requirements are the same: Node 24 in the supported 24.x line, one process,
a writable data directory outside release folders, and an HTTPS reverse proxy.

## Prepare the host

Create a private data directory owned by the service user. Download the platform-specific
`capacitylens-X.Y.Z.tar.gz` release archive, verify its accompanying `.sha256` file, unpack it, and
point a `current` symlink at the versioned directory. Keep this folder layout stable across
releases:

```text
/opt/capacitylens/current/backend/
/var/lib/capacitylens/capacitylens.db
/var/lib/capacitylens/backups/
/etc/capacitylens.env
```

Follow [Install without Docker](/self-hosting/install-without-docker) for the exact directory,
permissions, key generation and initial `app:upgrade` command.

## Configure the process

Copy `capacitylens.env.example` to a root-owned environment file outside the release. Set
`APP_URL` and `CAPACITYLENS_PUBLIC_URL` to the public HTTPS origin, keep `CAPACITYLENS_DB` and
`CAPACITYLENS_BACKUP_DIR` under the persistent data folder, and set independent secret values.
Configure the host's process manager to:

- run as the dedicated site user from `current/backend`;
- execute `node bin/server.js` with `NODE_ENV=production` and the private environment file;
- run exactly one application process and allow graceful shutdown;
- restart after an unexpected failure.

The archive's `capacitylens.service` is a systemd example. The application serves the web app and
API from the same process. Do not add a second server or public listener for the API.

## Route HTTPS traffic

Terminate public TLS at the platform proxy or a Caddy/nginx service on the same machine. A proxy
in another container or on another machine is not yet supported. Forward requests to
the loopback listener and overwrite forwarded host, address and scheme headers at that trusted
boundary. Do not expose the application port directly. See [TLS and networking](/self-hosting/tls-and-networking).

## First start and handover

With the service stopped, run `node ace.js app:upgrade` from `current/backend` under the same
environment. Start the service, check `/health/ready`, then complete the first-run page with the
private `CAPACITYLENS_SETUP_TOKEN`. Enter the company name in the browser to become Owner and open
Schedule. No company command or restart is needed. The server blocks additional open signup until
the first company exists, even when enabled in configuration. Remove the token at the next routine
configuration change.
Set up Google only if you intend to offer company sign-in; Microsoft remains deferred and GitHub
sign-in is retired. Deterministic checks do not establish live Google acceptance.

Before handover, prove the service restarts cleanly, confirm a scheduled snapshot exists, and give
whoever will maintain hosting the [backup](/self-hosting/backups-and-restore), [upgrade](/self-hosting/upgrades),
[monitoring](/self-hosting/monitoring) and [incident](/self-hosting/incidents) procedures.
