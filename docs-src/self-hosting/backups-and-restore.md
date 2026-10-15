---
title: Backups and restore
description: Protect and restore the native SQLite database using verified snapshots and the Adonis backup commands.
---

# Backups and restore

CapacityLens stores a company's data in one SQLite database. Keep the database and its backup
directory on persistent storage with access limited to the service user. A copy of the database
alone is not a recovery plan: retain multiple snapshots away from the host and rehearse restoration.

## Scheduled and manual snapshots

Set `CAPACITYLENS_BACKUP_DIR` to enable startup and periodic snapshots. The default interval is 60
minutes and the default retention is 48 snapshots. The first snapshot starts with the web service;
`/health/ready` reports pending or degraded backup health. See
[Configuration](/self-hosting/configuration) for the interval and retention settings.

To write a verified snapshot on demand, stop neither the application nor its users; the backup
command uses SQLite's online backup API. Run it from the archive's `backend/` directory with the
service environment loaded:

```bash
node ace.js db:backup
```

This command requires `CAPACITYLENS_BACKUP_DIR`. The resulting database snapshot is written to the
configured directory. Copy snapshots off the host and protect them like production data.

## Restore a snapshot

Restore into a new path so the current database remains available for investigation:

1. Stop the service and keep it stopped through the restore and validation.
2. Copy the selected verified snapshot to a new file in the persistent data directory. Do not
   copy a live SQLite database file while it is being written.
3. Point `CAPACITYLENS_DB` at the restored copy and run `node ace.js app:upgrade` from
   `backend/`. The command refuses unknown migration histories and checks schema integrity.
4. Start the service, check `/health/ready`, and verify the expected company and data before
   allowing normal use.
5. Keep the original database, snapshot and prior environment settings until the restore is
   accepted.

Never replace or delete the only copy of the current database before the restored copy passes
startup checks. Do not edit migration ledgers or released database files by hand.

## Recover a sole Owner's local password

This recovery command is available only when `CAPACITYLENS_MODE` is `password-only` or
`password-and-sso`, and the sole active Owner already has a local password. A Google-only
`sso-only` Owner cannot use it to create local password credentials. Stop the service and run the
command from `backend/` with the same private environment used by the service:

```bash
node ace.js owner:reset-password owner@example.com --confirm-server-stopped
```

The command emits a single-use reset link after recording the recovery action. Deliver the link
privately; do not put it in a ticket, shell history shared with others, or service logs.

## Replace an installation

`node ace.js app:reset <new-database-path> --confirm-server-stopped` is a separate, destructive
operator action. It requires the server to be stopped, preserves a verified snapshot and archived
copy of the original installation, then initializes a new database path. Update `CAPACITYLENS_DB`
only after the command succeeds. If it fails, preserve the named recovery files and partial
destination; do not retry over them.
