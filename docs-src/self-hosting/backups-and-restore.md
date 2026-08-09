---
title: Backups and restore
description: What CapacityLens backs up automatically, and the exact steps to restore a snapshot when you need one.
---

# Backups and restore

CapacityLens can take scheduled backups of its SQLite database automatically. This page
covers what gets backed up, how the automatic snapshots work, and — as a complete,
standalone procedure — how to restore one. If you're here because something has gone
wrong, skip straight to [Restore a snapshot](#restore-a-snapshot).

## What to back up

- **The SQLite database file** — the single source of truth for every company, person,
  project and allocation.
- **Its `-wal` and `-shm` sidecar files**, if present, whenever you copy it by hand — see
  the warning below.
- **The audit log** (JSONL). The database and the audit log share a single durability
  boundary: SQLite retains pending audit events until they're durably written to disk, so
  a complete recovery bundle includes both.

::: warning
Never `cp` a live database file as a backup. SQLite keeps recent writes in the `-wal`
file, so a plain file copy of `capacitylens.db` alone can be missing data or be
internally inconsistent. Use the scheduled snapshot mechanism below, or stop the API
first if you must copy files by hand.
:::

## Automatic snapshots

Set `CAPACITYLENS_BACKUP_DIR` to a directory and CapacityLens takes an online SQLite
backup at boot and on a configurable interval (`CAPACITYLENS_BACKUP_INTERVAL_MIN`,
default 60 minutes) — this uses SQLite's own backup API, not a file copy, so it's safe to
run against a live database. Docker Compose turns this on by default, snapshotting into
the `capacitylens-backups` volume; set `CAPACITYLENS_BACKUP_DIR=` (explicitly empty) to
turn it off.

Every snapshot is verified — an integrity check, a foreign-key check and a schema-version
check — before it's given its final name or counted for retention. A failed check is
logged as `backup FAILED`, the unpublished attempt is discarded, and every older restore
point is left untouched. `CAPACITYLENS_BACKUP_KEEP` (default 48, maximum 10,000) controls
how many snapshots are retained before the oldest are pruned.

New snapshots are named with a UTC-sortable timestamp:
`capacitylens-utc-YYYYMMDD-HHMMSS-sss.db`. Older `capacitylens-YYYYMMDD-HHMMSS-sss.db`
local-time snapshots (from earlier releases) remain valid restore inputs.

The on-host snapshot directory protects against many application and operator mistakes,
but not loss of the whole host. For real disaster recovery, also copy snapshots off-host
— to a separate account, region or provider, with tools like restic, rclone or rsync —
encrypt that destination, and monitor snapshot freshness. Deep health reports
`backup.status` and `backup.lastSuccessAt`; see
[Monitoring and health checks](/self-hosting/monitoring).

## Schedule a restore drill

Rehearse this before launch, and again after any material storage change — new host,
new volume driver, new backup destination. Don't let the first real restore be the first
time anyone has run it.

## Restore a snapshot

::: warning
Restoring replaces the live database with an older snapshot. Anything written after that
snapshot's timestamp is lost from the live database (it's still recoverable from an even
older snapshot only if that data existed there too). Preserve the current database before
you start — steps 1-2 below do this for you.
:::

### General procedure

1. Stop the API cleanly and wait for it to exit.
2. Copy the live database and its `-wal`/`-shm` sidecars somewhere safe, in case you need
   to roll back the restore itself.
3. Copy a selected dated `capacitylens-utc-YYYYMMDD-HHMMSS-sss.db` scheduled snapshot to
   the configured database path. Don't select a `capacitylens-pre-migration-*` file here
   — those belong to the [upgrade rollback procedure](/self-hosting/upgrades) instead.
4. Remove any stale `-wal` and `-shm` sidecars next to the restored file.
5. Start the API and check deep health.
6. Verify sign-in, the account list, recent expected data and one safe write.
7. Record the snapshot time, the result and how long the recovery took.

### Docker Compose named-volume procedure

The packaged Compose deployment stores `/data` and `/backups` in named Docker volumes,
so host-path `cp` commands can't reach them. Run everything below from the checkout that
has the active `.env` and `docker-compose.yml`. The commands use the API image's normal
unprivileged `node` user, so the restored files keep the ownership the API expects.

Before you start, confirm `docker compose config` renders the physical volume prefix
this installation actually uses. New deployments use `capacitylens_`. A deployment
created before the project name was pinned may carry a different historical prefix
through `COMPOSE_PROJECT_NAME` in `.env` — don't remove or change that override.

::: warning
If an upgrade unexpectedly presents an empty instance, do not create a company or remove
volumes. Stop the new stack, run `docker volume ls`, restore the previous project prefix
in `.env`, confirm the rendered `*_capacitylens-db`, `*_capacitylens-backups` and
`*_capacitylens-internal-tls` names, then start the stack and verify the expected account
list. Creating a company against the wrong volume set is not recoverable by restoring
later.
:::

1. Stop the API, list the available snapshots, and preserve the cleanly stopped live
   database inside the backups volume. This fails before touching `/data` if no snapshot
   is present:

   ```bash
   docker compose stop api
   docker compose run --rm --no-deps --entrypoint sh api -eu -c '
     ls -l /backups/capacitylens-*.db
     rollback_dir="/backups/manual-restore-$(date -u +%Y%m%dT%H%M%SZ)"
     umask 077
     mkdir -m 700 "$rollback_dir"
     for file in /data/capacitylens.db /data/capacitylens.db-wal /data/capacitylens.db-shm; do
       test ! -e "$file" || cp -p "$file" "$rollback_dir/"
     done
     printf "Preserved stopped database files in %s\n" "$rollback_dir"
   '
   ```

2. Choose the exact filename from that listing, then copy it into place, verify its mode
   and owner, atomically replace the live database, and remove sidecars. The basename
   check keeps the value confined to `/backups`:

   ```bash
   export RESTORE_SNAPSHOT=capacitylens-utc-YYYYMMDD-HHMMSS-sss.db
   docker compose run --rm --no-deps -e RESTORE_SNAPSHOT --entrypoint sh api -eu -c '
     case "$RESTORE_SNAPSHOT" in
       capacitylens-*.db) ;;
       *) echo "RESTORE_SNAPSHOT must be a capacitylens-*.db basename" >&2; exit 1 ;;
     esac
     case "$RESTORE_SNAPSHOT" in
       */*) echo "RESTORE_SNAPSHOT must not contain a path" >&2; exit 1 ;;
     esac
     source="/backups/$RESTORE_SNAPSHOT"
     target=/data/capacitylens.db
     temporary="$target.restore"
     test -f "$source"
     umask 077
     cp "$source" "$temporary"
     chmod 600 "$temporary"
     test "$(stat -c %a "$temporary")" = 600
     test "$(stat -c %u "$temporary")" = "$(id -u)"
     mv "$temporary" "$target"
     rm -f "$target-wal" "$target-shm"
   '
   unset RESTORE_SNAPSHOT
   ```

3. Start the API back up and check it:

   ```bash
   docker compose up -d api
   docker compose ps
   curl -fsS https://capacity.example.com/api/health
   ```

4. Complete the sign-in, account, recent-data and safe-write checks from the general
   procedure above before removing the preserved `manual-restore-*` directory from step 1.

If `CAPACITYLENS_DB` or `CAPACITYLENS_BACKUP_DIR` was deliberately changed from the
packaged paths, adapt and rehearse this procedure for those mounts before you actually
need it.

`server/src/restore.drill.test.ts` continuously exercises the backup, corruption and
restore path in CI, but that's not a substitute for an operator running this drill with
real storage and credentials.

## What's next

- [Upgrades](/self-hosting/upgrades) covers the separate pre-migration snapshot and
  application-rollback procedure for a schema-bearing release.
- [Monitoring and health checks](/self-hosting/monitoring) for watching backup freshness
  day to day.
