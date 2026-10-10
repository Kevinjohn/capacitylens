---
title: Upgrades
description: How to upgrade a self-hosted CapacityLens instance safely, what happens to the database on a schema change, and how to roll back.
---

# Upgrades

A native install extracts the next release archive beside the current one, switches `current`
to it and restarts. Docker Compose checks out the new release tag and rebuilds. Before any schema
change, CapacityLens takes and verifies its own rollback snapshot.

::: warning
Always take a fresh backup immediately before upgrading, even though the server also
takes its own pre-migration snapshot. See
[Backups and restore](/self-hosting/backups-and-restore).
:::

## Upgrade procedure

1. Confirm you have a recent, successful restore test on record.
2. Read `CHANGELOG.md` for migrations or breaking changes in the target release, and the
   release-specific sections below. On an older Compose installation, do the
   [one-time check](#one-time-check-for-older-compose-installations) first.
3. Take a fresh, explicit snapshot and keep it outside the release tree. A restore test proves
   the _procedure_ works; it isn't a current copy of live data, so keep an off-host copy too.
   See [Backups and restore](/self-hosting/backups-and-restore).

   On a [native install](/self-hosting/install-without-docker), stop the service and copy the
   database, its sidecars and the audit log into a new directory beside them:

   ```bash
   sudo systemctl stop capacitylens
   snapshot_dir="/var/lib/capacitylens/pre-upgrade-$(date -u +%Y%m%d-%H%M%S)"
   sudo install -d -o capacitylens -g capacitylens -m 0700 "$snapshot_dir"
   sudo sh -c 'cp -p /var/lib/capacitylens/capacitylens* "$1"' sh "$snapshot_dir"
   sudo ls -l "$snapshot_dir"
   ```

   The service is stopped, so the copy is consistent. Any `-wal` or `-shm` file copied with the
   database belongs to it; restore them together. Leave the service stopped for step 4.

4. Switch to the target release. For Docker Compose, check out its tag and rebuild:

   ```bash
   git fetch --tags
   git checkout vX.Y.Z
   docker compose up --build --force-recreate -d
   ```

   Compose stops the old `api` container before the new one starts, and recreates `web` only
   after the new `api` reports healthy, so two API versions never hold the SQLite file open
   together. Expect a gap of seconds while requests are refused or retried; that is a normal
   restart, not data loss. Never run old and new API versions against the same database at
   once. This step also reruns the internal certificate initializer and reloads the resulting
   identity into both long-running services.

   For a native install, with the service still stopped from step 3, extract the next archive
   beside the current one, switch `current` to it and start the service:

   ```bash
   curl -LO https://github.com/Kevinjohn/capacitylens/releases/download/vX.Y.Z/capacitylens-X.Y.Z.tar.gz
   sudo tar -xzf capacitylens-X.Y.Z.tar.gz -C /opt/capacitylens && sudo ln -sfn /opt/capacitylens/capacitylens-X.Y.Z /opt/capacitylens/current
   sudo systemctl start capacitylens
   ```

   Replace `vX.Y.Z` and `X.Y.Z` with the release you're deploying, not `main`. Change
   `/etc/capacitylens.env` first if the release notes ask for it. If they mention a change to
   `capacitylens.service`, copy the new one from the archive into `/etc/systemd/system/` and run
   `sudo systemctl daemon-reload` before the start. On a managed host, run the deploy script with
   the new version instead and restart the background process, as described in
   [Deploy on a managed VPS platform](/self-hosting/managed-vps/).

5. On first start, if the database needs a schema upgrade, CapacityLens creates and verifies a
   `capacitylens-pre-migration-vN-to-vM.db` snapshot before changing anything. If that snapshot
   fails, startup refuses to continue. Fix the underlying storage or permissions problem; do not
   bypass the snapshot.
6. Check API health, sign in, confirm account access, and make one safe write.
7. Keep the old container image, or on a native install the previous release folder, and the
   recovery snapshot until you're satisfied the upgrade is good.

## Roll back

CapacityLens has no down migrations, and an old image refuses to start against an upgraded
database. Rolling back always means restoring the matching snapshot as well as the old version:

1. Stop the API.
2. Restore the pre-migration snapshot this release created (or, if there wasn't one, the
   explicit snapshot from step 3), with no stale `-wal`/`-shm` files.
3. Start the old version. On a native install, point `current` back at the previous release
   folder with `sudo ln -sfn` before starting the service.

For Docker Compose's named volumes, use the
[restore procedure in Backups and restore](/self-hosting/backups-and-restore#docker-compose-named-volume-procedure)
with the exact `capacitylens-pre-migration-vN-to-vM.db` filename rather than copying host
paths.

## One-time check for older Compose installations

If your installation was created before the Compose project name was pinned to
`capacitylens`, do this once, before your next upgrade. Identify the database volume
attached to the running API:

```bash
db_volume="$(docker inspect "$(docker compose ps -q api)" \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')"
printf 'Database volume: %s\n' "$db_volume"
```

If that name isn't `capacitylens_capacitylens-db`, take the prefix before
`_capacitylens-db` and add it to your existing `.env`, for example
`COMPOSE_PROJECT_NAME=capacity-v1`. Keep that override for the life of the install. After
pulling the new release, run `docker compose config` and confirm its three rendered
volume names carry the same prefix before starting anything. If more than one candidate prefix
exists, stop and identify the volume mounted by the old API rather than guessing.

## Upgrading to 0.71.0-alpha.1

Before deploying this release, update `CAPACITYLENS_MODE` on every installation. The old
`password` and `sso` values now stop startup with a migration error. Choose the replacement by
the sign-in methods people actually use:

| Previous value                                              | Replacement        |
| ----------------------------------------------------------- | ------------------ |
| `password`, with no intended provider sign-in               | `password-only`    |
| `password`, with Google, Microsoft or GitHub sign-in in use | `password-and-sso` |
| `sso`                                                       | `sso-only`         |
| `off`                                                       | No change          |

`password-and-sso` needs at least one configured provider. `sso-only` needs Google or a
tenant-specific Microsoft provider; GitHub alone cannot satisfy it. `password-only` leaves stored
provider credentials and links in place but disables provider sign-in. Do not map every old
`password` setting to `password-only` without checking that installation's provider use.

Deploy the application and the environment change together, then verify sign-in with each
intended method. If rolling back to the previous application version, restore its old `password`
or `sso` value at the same time. Existing database migrations and provider links are unchanged.

## Better Auth 1.7.5 authentication changes

This release upgrades Better Auth from 1.6.30 to 1.7.5. CapacityLens keeps its authentication
policy and identity-admission checks; the underlying OAuth routes and provider integration
change.

Google and Microsoft use the callback paths `/api/auth/callback/google` and
`/api/auth/callback/microsoft`. Register the one you configure as described in
[Set up Google or Microsoft sign-in](/company-login/set-up-company-login). Delete any older
generic OIDC settings and the `hosted-oidc-only` profile rather than mapping them to a
replacement; the server no longer recognises them. There is no identity-conversion step.

Better Auth 1.7.0–1.7.2 temporarily required an `issuer` column in its `account` table, and
1.7.3 removed that requirement. A direct upgrade from 1.6.30 to 1.7.5 does not need the column.
If an installation actually ran one of those intermediate Better Auth releases, follow the
[upstream 1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide) before
continuing.

Microsoft accounts are identified by the directory-stable `oid` claim. Returning sign-in is
correlated to that identity; CapacityLens does not convert or merge identities by email.
Microsoft's `email` claim alone does not prove an address is verified; when the callback does
not prove the intended address, CapacityLens uses the one-time
[mailbox proof](/company-login/set-up-company-login#microsoft-mailbox-proof).

## Better Auth 1.7.7 authentication update

This release updates Better Auth from 1.7.6 to 1.7.7. A provider sign-in or account-linking
flow underway during the upgrade will not complete, including a return from the Microsoft
mailbox proof. Start it again once the new server is running.

Existing accounts, credentials and sessions remain in place. There is no database migration.

## Current schema changes

Company access restrictions use schema v47 and identity email proof uses v48. A legacy disabled
member becomes a principal-specific restriction; the upgrade does not infer mailbox ownership
from an older verified flag or invitation. New verified company sign-ins can establish durable
mailbox proof for later identity recreation. The automatic pre-migration snapshot remains the
rollback boundary for both tables. Existing GitHub links are not backfilled from old email
flags; a later GitHub callback records proof only when GitHub verifies the selected address and
it still matches the local identity.

Schema v49 removes outstanding invitations that were created without an intended email address,
and their old links stop working. Before upgrading, ask an Owner or Admin to note who still needs
access. After upgrading, they use **Team & access → Invite someone** to create a new invitation
for each person's exact email address and send the new one-time link. An old link cannot be
repaired or reused. People who already belong to the company keep their access and role.

Company joining requires a proven address and a company-specific joining link or addressed
invitation. Open and domain joining accepts existing identities with durable email proof; new
password identities use addressed invitations where the policy permits. Schema v50 supports this
joining journey for Microsoft sign-in; existing Microsoft sign-ins and pending mailbox ceremonies
remain intact.

The release that adds Studio and Supplementary engagement advances the database through
schema v29 (the required resource engagement column), v30 (the optional company-wide
engagement-grouping preference), v31 (the company working-day selection) and v32 (the optional
repeat-series identity on allocations). Existing resources become Studio resources, an absent
grouping preference reads as on, existing companies receive the first five days of their
configured week, and existing allocations remain unlinked. No manual data edit is required. To
roll back, restore the automatic pre-migration snapshot as described in [Roll back](#roll-back);
do not remove the new columns or edit the migration ledger by hand.

<span id="stored-credential-effects"></span>

When a release begins encrypting OAuth tokens at rest, tokens stored in plaintext by an earlier
version keep working and are re-encrypted the next time they refresh. There is no migration, no
operator action and no effect on sign-in. The `CHANGELOG.md` Security section names the release.

## Release-directory deployments

If your platform builds into versioned release directories and switches a stable `current`
symlink (Capistrano-style deploys, for example), build the new release while the existing
process keeps serving traffic. Stop the process immediately before activating the new release
and cleaning up the old one, then restart it from the stable path and verify `/api/health`.

Don't purge a release directory while a running service still has it as its working
directory. Keep the database, backups, environment file and operational logs outside the
release tree, so activation and rollback never replace persistent state.

## Before a schema-bearing release (maintainers)

Before shipping a release that changes the schema, run the migration rehearsal against
the committed auth fixture and again against a representative database:

```bash
pnpm run rehearse:migrations
pnpm run rehearse:migrations -- --source /path/to/representative.db
```

The source database is copied with SQLite's online backup API and never itself migrated; the
temporary copy is anonymised, vacuumed and deleted unless `--keep` is passed. A pass proves the
happy path, the verified rollback snapshot, the migration-ledger checksum, an injected
disk-exhaustion rollback, recovery from a forced termination at the final pending migration,
completion of the remaining chain after reopening, and an idempotent reopen for that database
shape. It never prints tenant content. Record the source schema version and row/table counts it
prints, with the result, in your release evidence.
