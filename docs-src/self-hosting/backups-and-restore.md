---
title: Backups and restore
description: What CapacityLens backs up automatically, what you must copy yourself, and the exact steps to restore a snapshot.
---

# Backups and restore

Restoring now? Go to [Restore a snapshot](#restore-a-snapshot).

In production, CapacityLens snapshots its database at start-up and every hour into a `backups`
folder beside the database file (Docker Compose: the `capacitylens-backups` volume), and keeps the
latest 48. Those snapshots sit on the same host. Your part:

1. [Copy the snapshots off-host](#copy-snapshots-off-the-server), to a separate account, region
   or provider, and encrypt that destination.
2. Keep a copy of the environment file in a password manager or off-host store, not beside the
   snapshots.
3. [Rehearse a restore](#schedule-a-restore-drill) before launch.
4. Alert on `backup.status` and `backup.lastSuccessAt` in deep health (see
   [Monitoring and health checks](/self-hosting/monitoring)).

Keep the database, audit log and backup storage on volumes encrypted at rest; CapacityLens does
not encrypt them itself.

## Copy snapshots off the server

Schedule the copy on the server, as a user that can read the backup folder. Each example runs
hourly and copies only finished snapshots: a snapshot being written has a temporary name that
does not end in `.db`.

On a Linux host, with rsync and root's SSH key authorised on a separate backup machine
(`backup.example.com` stands for yours), add this line to root's crontab with `sudo crontab -e`:

```text
15 * * * * rsync -a --include='capacitylens-*.db' --exclude='*' /var/lib/capacitylens/backups/ backup@backup.example.com:capacitylens/
```

On a managed host, install rclone, set up a remote for the site user with `rclone config`
(`offsite` stands for yours), and add an hourly scheduled job that runs as the site user (Forge:
the server's scheduler):

```text
rclone copy /home/forge/capacitylens-data/backups offsite:capacitylens --include 'capacitylens-*.db'
```

Both copy without deleting at the destination, so the copies outlive local retention; prune
them by your own policy. Check the destination after the first run, and copy the environment
file separately, by hand, to a password manager.

## What to back up

- **The SQLite database file**: all scheduling data. A scheduled snapshot is standalone; a hand
  copy also needs the `-wal` and `-shm` sidecar files if present.
- **The audit log** (JSONL), including the rotated `<file>.1` generation when it exists. Pending
  audit events wait in the database until written, so a complete recovery needs both.
- **The environment file**: `/etc/capacitylens.env` on a native install, or the site's
  environment on a managed host. A restore onto a new host needs its secrets and settings.

::: warning
Never `cp` a live database file as a backup. SQLite keeps recent writes in the `-wal`
file, so a plain copy of `capacitylens.db` alone can be missing data or be internally
inconsistent. Use the scheduled snapshots below, or stop the API first if you must copy
files by hand.
:::

## Automatic snapshots

Snapshots use SQLite's online backup API, so they are safe against a live database. Each passes
an integrity check, a foreign-key check and a schema-version check before it is named or counted
for retention. A failed check is logged as `backup FAILED`, the attempt is discarded, and older
restore points are untouched.

`CAPACITYLENS_BACKUP_DIR`, `CAPACITYLENS_BACKUP_INTERVAL_MIN` and `CAPACITYLENS_BACKUP_KEEP`
change the folder, interval and retention (maximum 10,000); `CAPACITYLENS_BACKUP_DIR=`
(explicitly empty) turns snapshots off. See
[Configuration](/self-hosting/configuration#the-database-and-backups).

Snapshots are named `capacitylens-utc-YYYYMMDD-HHMMSS-sss.db`. Older local-time
`capacitylens-YYYYMMDD-HHMMSS-sss.db` snapshots from earlier releases remain valid restore inputs.

## Schedule a restore drill

Rehearse a restore before launch, and again after a new host, volume driver or backup
destination. Use a staging host or a scratch folder with its own storage. You need:

- the exact release that will run the restored snapshot, unpacked from its archive (nothing to
  install or build);
- a dated `capacitylens-utc-*.db` or older local-time `capacitylens-*.db` snapshot, not a
  `capacitylens-pre-migration-*` file, which is only for [upgrade rollback](/self-hosting/upgrades);
- free space for a second copy, and a private place to record the result.

Do not use production database or named volumes, production ports, public proxies or provider
callback URLs. Run the commands from the unpacked release folder. Create a loopback-only scratch
environment and copy the snapshot into it:

```bash
drill_dir="$(mktemp -d /var/tmp/capacitylens-restore-drill.XXXXXX)" && install -d -m 700 "$drill_dir/backups" && cp /path/to/capacitylens-utc-YYYYMMDD-HHMMSS-sss.db "$drill_dir/capacitylens.db"
```

Start the API with an empty inherited environment, separate storage paths and a new signing
secret (never the production one):

```bash
env -i PATH="$PATH" NODE_ENV=production \
  CAPACITYLENS_SECRET='<drill-only secret of at least 32 characters>' \
  CAPACITYLENS_PUBLIC_URL=http://127.0.0.1:8877 \
  CAPACITYLENS_HEALTH_DEEP=1 \
  CAPACITYLENS_DB="$drill_dir/capacitylens.db" \
  CAPACITYLENS_AUDIT_FILE="$drill_dir/capacitylens-audit.jsonl" \
  CAPACITYLENS_BACKUP_DIR="$drill_dir/backups" \
  CAPACITYLENS_HOST=127.0.0.1 PORT=8877 \
  node server/dist/index.mjs
```

This matches an environment file from `init`, which sets no sign-in mode or deployment profile.
If the instance's own environment file sets `CAPACITYLENS_MODE` or
`CAPACITYLENS_DEPLOYMENT_PROFILE`, add those lines with the same values.

Do not expose the port or change the provider's registered callback. In a second shell, check
the isolated API:

```bash
curl -fsS http://127.0.0.1:8877/api/health
```

Deep health must report a successful database check, healthy audit state and a completed
backup: proof the release can migrate and open the copied storage. This drill cannot complete
Google or Microsoft sign-in; rehearse sign-in, reads and writes separately on an isolated staging
origin with that provider's non-production client registration and callback.

Stop the process, record the result, and remove only the temporary directory. For a Compose host,
drill with an off-host copy so the drill never mounts production volumes.

## Restore a snapshot

::: warning
Restoring replaces the live database with an older snapshot. Anything written after that
snapshot's timestamp is lost from the live database. Steps 1–2 below preserve the current
database first.
:::

### General procedure

1. Stop the API cleanly and wait for it to exit.
2. Copy the live database and its `-wal`/`-shm` sidecars somewhere safe, in case you need
   to roll back the restore. Preserve the current and rotated audit logs too; a snapshot does
   not replace them.
3. Copy the chosen `capacitylens-utc-YYYYMMDD-HHMMSS-sss.db` (or older
   `capacitylens-YYYYMMDD-HHMMSS-sss.db`) snapshot to the configured database path. Not a
   `capacitylens-pre-migration-*` file: those belong to
   [upgrade rollback](/self-hosting/upgrades).
4. Remove any stale `-wal` and `-shm` sidecars next to the restored file.
5. Start the API and check deep health.
6. Verify sign-in, the company list, recent expected data and one safe write.
7. Record the snapshot time, the result and how long the recovery took.

### Docker Compose named-volume procedure

Compose keeps `/data` and `/backups` in named volumes, which host-path `cp` cannot reach. Run
everything below from the checkout with the active `.env` and `docker-compose.yml`. The commands
run as the API image's unprivileged `node` user, so restored files keep the ownership the API
expects.

First confirm `docker compose config` renders the volume prefix this installation uses. New
deployments use `capacitylens_`. An older deployment may carry a different prefix through
`COMPOSE_PROJECT_NAME` in `.env`; don't remove or change that override.

::: warning
If an upgrade unexpectedly presents an empty instance, do not create a company or remove
volumes. Stop the new stack, run `docker volume ls`, restore the previous project prefix
in `.env`, confirm the rendered `*_capacitylens-db`, `*_capacitylens-backups` and
`*_capacitylens-internal-tls` names, then start the stack and verify the expected company
list. Creating a company against the wrong volume set is not recoverable by restoring
later.
:::

<span id="preserve-compose-files"></span>

1. Stop the API and preserve the cleanly stopped live database inside the backups volume:

   ```bash
   docker compose stop api
   docker compose run --rm --no-deps --entrypoint sh api -eu -c '
     test -f /data/capacitylens.db
     rollback_dir="/backups/manual-restore-$(date -u +%Y%m%dT%H%M%SZ)"
     umask 077
     mkdir -m 700 "$rollback_dir"
     for file in /data/capacitylens.db /data/capacitylens.db-wal /data/capacitylens.db-shm \
       /data/capacitylens-audit.jsonl /data/capacitylens-audit.jsonl.1; do
       test ! -e "$file" || cp -p "$file" "$rollback_dir/"
     done
     printf "Preserved stopped database files in %s\n" "$rollback_dir"
   '
   ```

2. List the snapshots and set the exact filename. The last command checks it is a dated
   snapshot in `/backups`, verifies mode and owner, atomically replaces the live database and
   removes sidecars:

   ```bash
   docker compose run --rm --no-deps --entrypoint sh api -eu -c 'ls -l /backups/capacitylens-*.db'
   export RESTORE_SNAPSHOT=capacitylens-utc-YYYYMMDD-HHMMSS-sss.db
   docker compose run --rm --no-deps -e RESTORE_SNAPSHOT --entrypoint sh api -eu -c '
     case "$RESTORE_SNAPSHOT" in
       capacitylens-pre-migration-*.db)
         echo "RESTORE_SNAPSHOT must not be a pre-migration backup; use the upgrade rollback procedure" >&2
         exit 1
         ;;
       capacitylens-utc-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-*.db|capacitylens-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-*.db) ;;
       *) echo "RESTORE_SNAPSHOT must be a dated capacitylens snapshot basename" >&2; exit 1 ;;
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

3. Start the API and check it:

   ```bash
   docker compose up -d api
   docker compose ps
   curl -fsS https://capacity.example.com/api/health
   ```

4. Complete the sign-in, company, recent-data and safe-write checks from the general
   procedure before removing the preserved `manual-restore-*` directory from step 1.

If `CAPACITYLENS_DB` or `CAPACITYLENS_BACKUP_DIR` was changed from the packaged paths, adapt
and rehearse this procedure for those mounts before you need it.
