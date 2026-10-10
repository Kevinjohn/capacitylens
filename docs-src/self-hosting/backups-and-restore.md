---
title: Backups and restore
description: What CapacityLens backs up automatically, what you must copy yourself, and the exact steps to restore a snapshot.
---

# Backups and restore

In production, CapacityLens snapshots its database automatically. You still need to copy
snapshots off the host, keep the environment file safe and rehearse a restore. Restoring now?
Go to [Restore a snapshot](#restore-a-snapshot).

## What to back up

- **The SQLite database file.** It holds every company, person, project and allocation. When
  you copy it by hand, also copy its `-wal` and `-shm` sidecar files if present. A scheduled
  snapshot is a standalone SQLite file and needs no sidecars.
- **The audit log** (JSONL), including the rotated `<file>.1` generation when it exists. SQLite
  holds pending audit events until they are durably written, so a complete recovery bundle
  includes both the database and the audit log.
- **The environment file**: `/etc/capacitylens.env` on a native install, or the site's
  environment on a managed host. It holds the secrets and settings the database runs with, so a
  restore onto a new host needs it. Keep a copy in a password manager or off-host store, not
  beside the snapshots.

::: warning
Never `cp` a live database file as a backup. SQLite keeps recent writes in the `-wal`
file, so a plain copy of `capacitylens.db` alone can be missing data or be internally
inconsistent. Use the scheduled snapshots below, or stop the API first if you must copy
files by hand.
:::

## Automatic snapshots

Set `CAPACITYLENS_BACKUP_DIR` to a directory and CapacityLens takes an online SQLite backup at
boot and every `CAPACITYLENS_BACKUP_INTERVAL_MIN` minutes (default 60). It uses SQLite's backup
API, not a file copy, so it is safe against a live database. Under `NODE_ENV=production` it is on
by default, writing to a `backups` folder beside the database file; Docker Compose writes to the
`capacitylens-backups` volume. Set `CAPACITYLENS_BACKUP_DIR=` (explicitly empty) to turn it off.

Each snapshot passes an integrity check, a foreign-key check and a schema-version check before
it is given its final name or counted for retention. A failed check is logged as
`backup FAILED`, the attempt is discarded, and older restore points are untouched.
`CAPACITYLENS_BACKUP_KEEP` (default 48, maximum 10,000) sets how many snapshots are kept before
the oldest are pruned.

Snapshots are named `capacitylens-utc-YYYYMMDD-HHMMSS-sss.db`. Older local-time
`capacitylens-YYYYMMDD-HHMMSS-sss.db` snapshots from earlier releases remain valid restore inputs.

On-host snapshots do not survive loss of the whole host. Also copy them off-host, to a separate
account, region or provider (with restic, rclone or rsync, for example), encrypt that
destination, and monitor snapshot freshness. Keep the database, audit log and backup storage on
volumes encrypted at rest; CapacityLens does not encrypt them itself. Deep health reports
`backup.status` and `backup.lastSuccessAt`; see
[Monitoring and health checks](/self-hosting/monitoring).

## Schedule a restore drill

Rehearse a restore before launch, and again after any material storage change: new host, new
volume driver or new backup destination.

Use a staging host or a scratch folder with its own storage. You need:

- the exact release that will run the restored snapshot, unpacked from its archive (it already
  holds the built server at `server/dist/index.mjs`, so there is nothing to install or build);
- a dated `capacitylens-utc-*.db` or older local-time `capacitylens-*.db` snapshot. The
  `capacitylens-pre-migration-*` files are only for [upgrade rollback](/self-hosting/upgrades);
- free space for a second copy, and a private place to record the result.

Do not use production database or named volumes, production ports, public proxies or provider
callback URLs. Run the next commands from the unpacked release folder.

Create a loopback-only scratch environment and copy the snapshot into it:

```bash
drill_dir="$(mktemp -d /var/tmp/capacitylens-restore-drill.XXXXXX)" && install -d -m 700 "$drill_dir/backups" && cp /path/to/capacitylens-utc-YYYYMMDD-HHMMSS-sss.db "$drill_dir/capacitylens.db"
```

Start the API with an empty inherited environment, the same sign-in mode and deployment profile
as production, separate storage paths and a newly generated signing secret (never the production
one). The example is for password mode:

```bash
env -i PATH="$PATH" NODE_ENV=production \
  CAPACITYLENS_DEPLOYMENT_PROFILE=self-hosted-password \
  CAPACITYLENS_MODE=password-only \
  CAPACITYLENS_SECRET='<drill-only secret of at least 32 characters>' \
  CAPACITYLENS_PUBLIC_URL=http://127.0.0.1:8877 \
  CAPACITYLENS_RATE_LIMIT=300 \
  CAPACITYLENS_HEALTH_DEEP=1 \
  CAPACITYLENS_DB="$drill_dir/capacitylens.db" \
  CAPACITYLENS_AUDIT_FILE="$drill_dir/capacitylens-audit.jsonl" \
  CAPACITYLENS_BACKUP_DIR="$drill_dir/backups" \
  CAPACITYLENS_HOST=127.0.0.1 PORT=8877 \
  node server/dist/index.mjs
```

Do not expose the port or change the provider's registered callback. Leave the process running
and, in a second shell, check the isolated API:

```bash
curl -fsS http://127.0.0.1:8877/api/health
```

Confirm deep health reports a successful database check, healthy audit state and a completed
backup. That proves the release can migrate and open the copied storage. This loopback drill
cannot complete Google or Microsoft sign-in: rehearse sign-in, reads and writes separately on an
isolated staging origin with that provider's non-production client registration and callback.

Stop the process, keep the result your recovery policy requires, and remove only the temporary
directory. The drill also works for a snapshot copied off a Compose host; use the off-host copy
so the drill never mounts production volumes.

## Restore a snapshot

::: warning
Restoring replaces the live database with an older snapshot. Anything written after that
snapshot's timestamp is lost from the live database. Preserve the current database before you
start; steps 1–2 below do this.
:::

### General procedure

1. Stop the API cleanly and wait for it to exit.
2. Copy the live database and its `-wal`/`-shm` sidecars somewhere safe, in case you need
   to roll back the restore itself. Preserve the current and rotated audit logs separately;
   a scheduled database snapshot does not replace those files.
3. Copy a selected dated `capacitylens-utc-YYYYMMDD-HHMMSS-sss.db` (or older
   `capacitylens-YYYYMMDD-HHMMSS-sss.db`) scheduled snapshot to the configured database
   path. Don't select a `capacitylens-pre-migration-*` file here; those belong to the
   [upgrade rollback procedure](/self-hosting/upgrades).
4. Remove any stale `-wal` and `-shm` sidecars next to the restored file.
5. Start the API and check deep health.
6. Verify sign-in, the account list, recent expected data and one safe write.
7. Record the snapshot time, the result and how long the recovery took.

### Docker Compose named-volume procedure

The packaged Compose deployment keeps `/data` and `/backups` in named Docker volumes, so
host-path `cp` commands can't reach them. Run everything below from the checkout that has the
active `.env` and `docker-compose.yml`. The commands run as the API image's unprivileged `node`
user, so restored files keep the ownership the API expects.

First confirm `docker compose config` renders the volume prefix this installation actually
uses. New deployments use `capacitylens_`. A deployment created before the project name was
pinned may carry a different historical prefix through `COMPOSE_PROJECT_NAME` in `.env`; don't
remove or change that override.

::: warning
If an upgrade unexpectedly presents an empty instance, do not create a company or remove
volumes. Stop the new stack, run `docker volume ls`, restore the previous project prefix
in `.env`, confirm the rendered `*_capacitylens-db`, `*_capacitylens-backups` and
`*_capacitylens-internal-tls` names, then start the stack and verify the expected account
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

2. List the snapshots and choose the exact filename. The second command copies it into place,
   verifies its mode and owner, atomically replaces the live database and removes sidecars. The
   basename check keeps the value confined to `/backups`:

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

4. Complete the sign-in, account, recent-data and safe-write checks from the general
   procedure above before removing the preserved `manual-restore-*` directory from step 1.

If `CAPACITYLENS_DB` or `CAPACITYLENS_BACKUP_DIR` was changed from the packaged paths, adapt
and rehearse this procedure for those mounts before you need it.

For the separate pre-migration snapshot and application rollback, see
[Upgrades](/self-hosting/upgrades).
