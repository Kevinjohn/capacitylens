---
title: Upgrades
description: How to upgrade a self-hosted CapacityLens instance safely, what happens to the database on a schema change, and how to roll back.
---

# Upgrades

Move to a newer release without losing data, and roll back if it fails.

::: warning
Always take a fresh backup immediately before upgrading, even though the server also takes its own
pre-migration snapshot. See [Backups and restore](/self-hosting/backups-and-restore).
:::

<span id="upgrade-procedure"></span>

## Upgrade to a newer release

1. Confirm you have a recent, successful restore test on record.
2. Read `CHANGELOG.md` for the target release and any
   [release-specific actions](#release-specific-actions) you cross. On an older Compose
   installation, do the [one-time check](#one-time-check-for-older-compose-installations) first.
3. Take a fresh, explicit snapshot outside the release tree, and keep an off-host copy; a restore
   test isn't a current copy of live data. On a
   [native install](/self-hosting/install-without-docker), stop the service and copy the database,
   its sidecars and the audit log:

   ```bash
   sudo systemctl stop capacitylens
   snapshot_dir="/var/lib/capacitylens/pre-upgrade-$(date -u +%Y%m%d-%H%M%S)"
   sudo install -d -o capacitylens -g capacitylens -m 0700 "$snapshot_dir"
   sudo sh -c 'cp -p /var/lib/capacitylens/capacitylens* "$1"' sh "$snapshot_dir"
   sudo ls -l "$snapshot_dir"
   ```

   Any `-wal` or `-shm` file copied with the database belongs to it; restore them together. Leave
   the service stopped.

4. Switch to the target release (`vX.Y.Z` / `X.Y.Z`, never `main`).

   Docker Compose:

   ```bash
   git fetch --tags
   git checkout vX.Y.Z
   docker compose up --build --force-recreate -d
   ```

   Compose stops the old `api` before the new one starts, so expect a few seconds of refused or
   retried requests. Never run old and new API versions against the same database at once.

   Native install:

   ```bash
   curl -LO https://github.com/Kevinjohn/capacitylens/releases/download/vX.Y.Z/capacitylens-X.Y.Z.tar.gz
   sudo tar -xzf capacitylens-X.Y.Z.tar.gz -C /opt/capacitylens && sudo ln -sfn /opt/capacitylens/capacitylens-X.Y.Z /opt/capacitylens/current
   sudo systemctl start capacitylens
   ```

   Change `/etc/capacitylens.env` first if the release notes ask for it. If they mention a change to
   `capacitylens.service`, copy the new one from the archive into `/etc/systemd/system/` and run
   `sudo systemctl daemon-reload` before the start. On a managed host, run the deploy script with
   the new version and restart the background process, as described in
   [Deploy on a managed host](/self-hosting/managed-vps/).

5. On first start, a schema upgrade first creates and verifies a
   `capacitylens-pre-migration-vN-to-vM.db` snapshot in the backups folder. If that fails, startup
   stops: fix the storage or permissions problem; don't bypass the snapshot.
6. Check API health, sign in, confirm the company opens, and make one safe write.
7. Keep the old container image or previous release folder, and the recovery snapshot, until you're
   satisfied.

## Roll back

There are no down migrations. If the release changed the schema, switching code alone is not a
rollback: never start the old release against a database the new one has migrated. Put back the
`capacitylens-pre-migration-vN-to-vM.db` snapshot the new release wrote, then start the old
release.

::: warning
Rolling back loses everything written since the upgrade started. Stop the server before you touch
the database, and remove any `-wal` or `-shm` file beside the restored database: they belong to
the upgraded one.
:::

The snapshot is in the backups folder, or beside the database when scheduled backups are off. If
the release had no schema change, there is no snapshot: stop, switch back and start. Don't remove
new columns or edit the migration ledger by hand.

### Docker Compose

1. Stop the API and preserve the upgraded database: run
   [step 1 of the Compose restore procedure](/self-hosting/backups-and-restore#preserve-compose-files).
2. List the pre-migration snapshots:

   ```bash
   docker compose run --rm --no-deps --entrypoint sh api -eu -c 'ls -l /backups/capacitylens-pre-migration-*.db'
   ```

3. Set the exact filename, then copy it over the database and remove the sidecars:

   ```bash
   export ROLLBACK_SNAPSHOT=capacitylens-pre-migration-vN-to-vM.db
   docker compose run --rm --no-deps -e ROLLBACK_SNAPSHOT --entrypoint sh api -eu -c '
     case "$ROLLBACK_SNAPSHOT" in
       */*) echo "ROLLBACK_SNAPSHOT must not contain a path" >&2; exit 1 ;;
       capacitylens-pre-migration-v[0-9]*-to-v[0-9]*.db) ;;
       *) echo "ROLLBACK_SNAPSHOT must be a capacitylens-pre-migration-vN-to-vM.db basename" >&2; exit 1 ;;
     esac
     source="/backups/$ROLLBACK_SNAPSHOT"
     target=/data/capacitylens.db
     temporary="$target.restore"
     test -f "$source"
     umask 077
     cp "$source" "$temporary"
     chmod 600 "$temporary"
     mv "$temporary" "$target"
     rm -f "$target-wal" "$target-shm"
   '
   unset ROLLBACK_SNAPSHOT
   ```

4. Check out the previous release and rebuild it. Undo any `.env` change the new release needed
   first:

   ```bash
   git checkout vX.Y.Z
   docker compose up --build --force-recreate -d
   ```

5. Check `https://capacity.example.com/api/health`, sign in and confirm the company opens.

### Release archive on a Linux host

1. Stop the service and preserve the upgraded database:

   ```bash
   sudo systemctl stop capacitylens
   rollback_dir="/var/lib/capacitylens/rolled-back-$(date -u +%Y%m%d-%H%M%S)"
   sudo install -d -o capacitylens -g capacitylens -m 0700 "$rollback_dir"
   sudo sh -c 'cp -p /var/lib/capacitylens/capacitylens* "$1"' sh "$rollback_dir"
   ```

2. List the pre-migration snapshots:

   ```bash
   sudo ls -l /var/lib/capacitylens/backups/
   ```

3. Copy the one this upgrade wrote over the database, with the service's owner and mode:

   ```bash
   sudo install -o capacitylens -g capacitylens -m 0600 /var/lib/capacitylens/backups/capacitylens-pre-migration-vN-to-vM.db /var/lib/capacitylens/capacitylens.db
   ```

4. Remove the upgraded database's sidecars:

   ```bash
   sudo rm -f /var/lib/capacitylens/capacitylens.db-wal /var/lib/capacitylens/capacitylens.db-shm
   ```

5. Point `current` back at the previous release. Undo any `/etc/capacitylens.env` or
   `capacitylens.service` change the new release needed first:

   ```bash
   sudo ln -sfn /opt/capacitylens/capacitylens-X.Y.Z /opt/capacitylens/current
   ```

6. Start the service and check health:

   ```bash
   sudo systemctl start capacitylens
   ```

   ```bash
   curl -fsS http://127.0.0.1:8787/api/health
   ```

To roll back to the explicit snapshot from [step 3 of the upgrade](#upgrade-to-a-newer-release)
instead, copy all of its files back into `/var/lib/capacitylens` in place of steps 3 and 4: its
`-wal` and `-shm` files belong to it.

### Managed host

Follow [Roll back](/self-hosting/managed-vps/#roll-back) on Deploy on a managed host. It also
returns the deploy script to the previous version, so the next deploy does not reinstate the new
release.

## One-time check for older Compose installations

If your installation predates the Compose project name being pinned to `capacitylens`, do this once
before your next upgrade. Identify the database volume attached to the running API:

```bash
db_volume="$(docker inspect "$(docker compose ps -q api)" \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')"
printf 'Database volume: %s\n' "$db_volume"
```

If it isn't `capacitylens_capacitylens-db`, add the prefix before `_capacitylens-db` to your
existing `.env`, for example `COMPOSE_PROJECT_NAME=capacity-v1`, and keep it for the life of the
install. After pulling the new release, run `docker compose config` and confirm its three rendered
volume names carry the same prefix before starting anything. If more than one candidate prefix
exists, stop and identify the volume mounted by the old API rather than guessing.

## Release-specific actions

Full notes are in `CHANGELOG.md` and the GitHub release notes. Upgrading across these releases needs
the following:

- **0.71.0-alpha.1**: replace `CAPACITYLENS_MODE`, as described
  [below](#upgrading-to-0-71-0-alpha-1).
- **Better Auth 1.7.5**: register `/api/auth/callback/google` or `/api/auth/callback/microsoft` as
  in [Set up Google or Microsoft sign-in](/company-login/set-up-company-login). Delete older generic
  OIDC settings and the `hosted-oidc-only` profile; don't map them to a replacement. Only if the
  installation actually ran Better Auth 1.7.0–1.7.2, follow the
  [upstream 1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide) first.
- **Better Auth 1.7.7**: a provider sign-in or account-linking flow underway during the upgrade,
  including a Microsoft mailbox proof, won't complete. Start it again once the new server is
  running.
- **Schema v49**: outstanding invitations without an intended email address are removed and their
  links stop working. Before upgrading, an Owner or Admin notes who still needs access; afterwards
  they use **Team & access → Invite someone** for each person's exact address. Existing members keep
  their access and role.
- **Schema v29–v32, v47, v48, v50**: no action. Roll back only with the automatic pre-migration
  snapshot. The v48 upgrade does not infer mailbox proof from older verified flags or invitations,
  and does not backfill proof for existing GitHub links. Joining a company now needs a proven
  address plus a company joining link or an addressed invitation; v50 adds this journey for
  Microsoft sign-in.
- <span id="stored-credential-effects"></span>**OAuth token encryption at rest**: no action. Tokens
  stored in plaintext keep working and are re-encrypted on their next refresh.

### Upgrading to 0.71.0-alpha.1

Update `CAPACITYLENS_MODE` on every installation before deploying; the old `password` and `sso`
values stop startup with a migration error. Choose by the sign-in methods people actually use:

| Previous value                                              | Replacement        |
| ----------------------------------------------------------- | ------------------ |
| `password`, with no intended provider sign-in               | `password-only`    |
| `password`, with Google, Microsoft or GitHub sign-in in use | `password-and-sso` |
| `sso`                                                       | `sso-only`         |
| `off`                                                       | No change          |

`password-and-sso` needs at least one configured provider. `sso-only` needs Google or a
tenant-specific Microsoft provider; GitHub alone cannot satisfy it. `password-only` keeps stored
provider credentials and links but disables provider sign-in. Don't map every old `password` setting
to `password-only` without checking that installation's provider use.

Deploy the application and the environment change together, then verify sign-in with each intended
method. When rolling back to the previous version, restore its old `password` or `sso` value at the
same time.

<span id="release-directory-deployments"></span>

## Upgrade a release-directory deployment

If your platform builds into versioned release directories and switches a stable `current` symlink,
build the new release while the existing process keeps serving. Stop the process immediately before
activating the new release and cleaning up the old one, then restart from the stable path and verify
`/api/health`.

Don't purge a release directory a running service still uses as its working directory. Keep the
database, backups, environment file and operational logs outside the release tree.
