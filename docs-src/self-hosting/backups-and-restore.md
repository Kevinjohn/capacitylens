---
title: Backups and restore
description: Protect and restore the native SQLite database using verified snapshots and the Adonis backup commands.
---

# Backups and restore

CapacityLens stores a company's data in one SQLite database. Keep the database and its backup
directory on persistent storage with access limited to the service user. A copy of the database
alone is not a recovery plan: retain multiple snapshots away from the host and rehearse restoration.

## Scheduled and manual snapshots

Set `CAPACITYLENS_BACKUP_DIR` to enable an online snapshot at web-service startup and every 24
hours while it runs. `CAPACITYLENS_BACKUP_KEEP` controls how many completed managed snapshots to
retain; the default is 48. A running backup prevents another scheduled job from overlapping it.
See [Configuration](/self-hosting/configuration) for retention settings.

Check the service logs for backup failures and confirm that recent completed snapshots exist.
Readiness checks the database; it does not track backup success.

To write a verified snapshot on demand, stop neither the application nor its users; the backup
command uses SQLite's online backup API. Run it from the archive's `backend/` directory with the
service environment loaded:

```bash
node ace.js db:backup
```

This command requires `CAPACITYLENS_BACKUP_DIR`. The resulting database snapshot is written to the
configured directory. Scheduled and manual snapshots share count-based retention: after a
successful snapshot, excess older managed snapshots are removed. Pre-upgrade snapshots, temporary
files and unrelated files are excluded. If an older in-flight backup finishes after a newer one,
retention protects both the newly written snapshot and the newest recovery point. The completed
count can exceed the configured target until a later successful backup reapplies the limit.
A failed copy is not published as a completed snapshot and does not trigger retention. Copy
snapshots off the host and protect them like production data.

An interrupted process can leave unpublished `.tmp` files and their `-wal` or `-shm` sidecars.
Retention excludes these files, and startup does not sweep them. To reclaim their disk space,
stop the service and wait for any manual backup commands to finish. Inspect the backup directory
and remove only confirmed abandoned temporary files; preserve completed `.db` snapshots and
pre-upgrade recovery files.

## Restore a snapshot

Restore into a new path so the current database remains available for investigation:

1. Stop the service and keep it stopped through the restore and validation.
2. Copy the selected verified snapshot to a new file in the persistent data directory. Do not
   copy a live SQLite database file while it is being written.
3. Point `CAPACITYLENS_DB` at the restored copy and run `node ace.js app:upgrade` from
   `backend/`. The command runs pending migrations and checks schema integrity.
4. Start the service, check `/health/ready`, and verify the expected company and data before
   allowing normal use.
5. Keep the original database, snapshot and prior environment settings until the restore is
   accepted.

Never replace or delete the only copy of the current database before the restored copy passes
startup checks. Do not edit the migration journal or database files by hand.

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

`node ace.js app:reset <new-database-path> --confirm-server-stopped --disposable` is a separate, destructive
operator action. It is unavailable in production and requires an explicit disposable confirmation
outside production. It requires the server to be stopped, preserves a verified snapshot and archived
copy of the original installation, then initializes a new database path. Update `CAPACITYLENS_DB`
only after the command succeeds. If it fails, preserve the named recovery files and partial
destination; do not retry over them.
