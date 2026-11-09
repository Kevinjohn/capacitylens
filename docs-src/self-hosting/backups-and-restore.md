---
title: Backups and restore
description: Protect and restore the native SQLite database using verified bundles and the Adonis backup commands.
---

# Backups and restore

CapacityLens stores a company's data in one SQLite database. Keep the live database outside the
backup directory, with access limited to the service user. Use plain filesystem paths, not `file:`
URIs. Scheduled, pre-migration and reset backups require **local storage only**; network filesystems
such as NFS are unsupported. Retain protected copies away from the host and rehearse restoration.

## Scheduled and manual bundles

Set `CAPACITYLENS_BACKUP_DIR` to enable a backup at web-service startup and every 24 hours while it
runs. Startup checks the source and prepares the root with mode `0700`. If that root disappears
later, a scheduled run fails without recreating it. Restore the storage/mount and permissions before
retrying. Unset or empty configuration disables scheduling without preventing application startup.

`CAPACITYLENS_BACKUP_KEEP` defaults to 48 completed READY bundles. A scheduled run skips overlapping
work, creates one bundle, then prunes after success. Failed creates do not prune. Prune failures are
logged separately and do not invalidate a successful backup. Readiness checks the database, so inspect
backup logs and completed bundles separately. Diagnostics reports the maximum manifest creation time,
which can differ from name order after a backward clock step.

Each bundle is a directory named `bak-utc-YYYYMMDD-HHMMSS-mmm` containing:

```text
bak-utc-20261108-120000-000/
  db.sqlite
  manifest.json
  READY
```

The package makes a one-step online copy, checks full SQLite integrity, foreign keys and the migration
journal, records size and SHA-256 in the manifest, then writes READY last. Only READY bundles are
recovery points. Database, manifest and READY files are read-only.

Run manual commands as the service user with the same private environment as the service. A
manual create can run while the application is online:

```bash
sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
  -p WorkingDirectory=/opt/capacitylens/current/backend \
  -p EnvironmentFile=/etc/capacitylens.env \
  -p Environment=NODE_ENV=production \
  /usr/bin/env node ace.js db:backup create
```

Use `list`, `verify --bundle <name>` or `prune` in place of `create` for the other actions.

Manual create prepares the configured directory; confirm its storage is mounted first. It creates a
bundle without pruning; use `prune` explicitly afterward. Prune keeps the newest configured count in
name order and removes unfinished bundles under the directory lock. `--keep <count>` overrides the
retention count for that prune. `list`, `verify` and `restore-prepare` accept `--directory <path>` to
read another backup root, including when scheduling is disabled. Create and prune use the configured root.

Pre-upgrade bundles go to `<configured backup directory>/pre-migration`, or `<database path>.backups`
when scheduling is disabled. Reset archives live beside the original database. Scheduled retention does
not manage either destination. Old `capacitylens-*.db` scheduled snapshots are not managed by the new
retention; never delete the live database, pre-migration files or reset archives as retention cleanup.

An interrupted create can leave a bundle directory without READY. It is not a backup; the next prune
removes it once no creator holds the lock. Use `db:backup prune` rather than deleting files from an
active backup root. Unrelated files are left alone. Preserve verified copies before reclaiming space.

Names increase within a root. If its newest bundle is dated more than 24 hours after the clock, create
refuses. Correct the clock or move the verified future bundle to a separate protected recovery directory
before trying again; preserve that recovery point. A backward step within 24 hours adjusts the next name,
while its manifest still records the actual clock time.

## Restore a bundle

Stage into a new path so the current database remains available for investigation:

1. Stop the service and keep it stopped through restoration and validation.
2. Choose a recovery point and stage a verified copy:

   ```bash
   sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
     -p WorkingDirectory=/opt/capacitylens/current/backend \
     -p EnvironmentFile=/etc/capacitylens.env \
     -p Environment=NODE_ENV=production \
     /usr/bin/env node ace.js db:backup list --directory /var/lib/capacitylens/backups
   sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
     -p WorkingDirectory=/opt/capacitylens/current/backend \
     -p EnvironmentFile=/etc/capacitylens.env \
     -p Environment=NODE_ENV=production \
     /usr/bin/env node ace.js db:backup restore-prepare --directory /var/lib/capacitylens/backups \
     --bundle <name> --target /var/lib/capacitylens/restored.db
   ```

   Omit `--directory` to use the configured root. Both commands work with an explicit directory while
   scheduling is disabled. The target must be new, outside the backup root and live database/sidecar
   paths, with no existing sidecars. `restore-prepare` checks the staged copy and never replaces the live file.
3. Point `CAPACITYLENS_DB` at the staged copy in `/etc/capacitylens.env`, then run the upgrade as
   the service user with the service environment. The command backs up existing data, runs pending
   migrations and checks schema integrity:

   ```bash
   sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
     -p WorkingDirectory=/opt/capacitylens/current/backend \
     -p EnvironmentFile=/etc/capacitylens.env \
     -p Environment=NODE_ENV=production \
     /usr/bin/env node ace.js app:upgrade
   ```
4. Start the service, check `/health/ready`, and verify the expected company and data before normal use.
5. Keep the original database, bundle and prior environment settings until the restore is accepted.

Never replace or delete the only copy of the current database before the staged copy passes startup
checks. Do not edit migration journals or database files by hand. Protect off-host bundles like production data.

## Recover a sole Owner's local password

Use this when the sole active Owner cannot reset their own password. Stop the service and run the
command as the service user with the same private environment used by the service:

```bash
sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
  -p WorkingDirectory=/opt/capacitylens/current/backend \
  -p EnvironmentFile=/etc/capacitylens.env \
  -p Environment=NODE_ENV=production \
  /usr/bin/env node ace.js owner:reset-password owner@example.com --confirm-server-stopped
```

The command emits a single-use reset link after recording the recovery action. Deliver the link
privately; do not put it in a ticket, shell history shared with others, or service logs.

## Replace an installation

`node ace.js app:reset <new-database-path> --confirm-server-stopped --disposable` is a separate,
destructive operator action. It is unavailable in production and requires an explicit disposable
confirmation outside production. It requires the server to be stopped, preserves a verified snapshot
and archived copy of the original installation, then initializes a new database path. Update
`CAPACITYLENS_DB` only after the command succeeds. If it fails, preserve the named recovery files and
partial destination; do not retry over them.
