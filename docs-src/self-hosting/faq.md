---
title: Install and operations FAQ
description: Answers about native installation, authentication, backups, upgrades, monitoring and recovery.
next: false
---

# Install and operations FAQ

## Installation

### Do I need Docker?

No. Use the [native release archive](/self-hosting/install-without-docker). Docker deployment for
the current application has not been validated; see [Install with Docker](/self-hosting/install-with-docker).

### Which Node version should I use?

Use Node 24 within the supported 24.x line. The service needs this runtime on the host.

### Is the local demo an installation route?

No. The demo keeps temporary in-memory data and resets when it reloads. Do not use it for company
records.

### Who creates the first company?

The first identity completes setup using `CAPACITYLENS_SETUP_TOKEN`; that person becomes the first
Owner and creates the company. Remove the token after setup.

### Which company sign-in providers are available?

Password and Google are supported. Microsoft is deferred and GitHub is retired. A successful local
configuration does not prove live Google sign-in; verify it with the actual provider registration.

## Operations

### What should I monitor?

Check `/health/live` for process liveness and `/health/ready` for database and backup readiness.
Also watch disk space, service restarts and the freshness of off-host snapshots. See
[Monitoring](/self-hosting/monitoring).

### Is a scheduled backup enough?

Only when snapshots are copied off-host, protected and proven restorable. Keep the original database
until a restore has passed startup checks. See [Backups and restore](/self-hosting/backups-and-restore).

### Can I upgrade by replacing the files and restarting?

No. Run `node ace.js app:upgrade` from the new release's `backend/` directory before restarting.
It checks the released migration manifest and takes a verified pre-upgrade snapshot when needed.
See [Upgrades](/self-hosting/upgrades).

### How do I recover the sole Owner's access?

The command applies only when `CAPACITYLENS_MODE` is `password-only` or `password-and-sso` and the
sole active Owner already has a local password. A Google-only `sso-only` Owner cannot use it to
create local password credentials. Stop the service and use
`node ace.js owner:reset-password <email> --confirm-server-stopped` from the release's `backend/`
directory. The audited command issues a single-use recovery link; deliver it privately and never
set a password directly. See [When something goes wrong](/self-hosting/incidents).

### How do I move to a new host?

Copy a verified snapshot to the new host, point `CAPACITYLENS_DB` at the restored copy, run
`node ace.js app:upgrade`, and verify readiness and sign-in before changing DNS. Keep the original
database and secrets until the move is accepted.

### How do I uninstall?

Stop and disable the service, preserve any recovery files you need, then remove the service unit,
release directories, environment file, data directory and proxy configuration. Deleting the data
directory permanently removes the database, audit data and local snapshots; verify an off-host
backup first.
