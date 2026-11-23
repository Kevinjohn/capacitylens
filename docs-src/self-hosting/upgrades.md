---
title: Upgrades
description: Upgrade CapacityLens by fetching a new tag, building it and running the migration command, with a verified pre-migration backup.
---

# Upgrade CapacityLens

Keep the database and backup directory outside the clone. Before changing the running code, read
the release notes and confirm that a recent backup can be read. Use one process and stop it before
running the migration command.

## Upgrade to a new tag

Stop the service first: the build replaces the directory the running server reads. Then fetch
the new tag, install the locked dependencies and build:

```bash
sudo systemctl stop capacitylens
cd /opt/capacitylens
sudo git fetch --tags
sudo git checkout vX.Y.Z
sudo pnpm install --frozen-lockfile
sudo env NODE_ENV=production HOST=127.0.0.1 PORT=0 LOG_LEVEL=error \
  APP_KEY=capacitylens-build-key-0123456789abcdef \
  APP_URL=https://127.0.0.1 CAPACITYLENS_PUBLIC_URL=https://127.0.0.1 pnpm run build
```

Then upgrade the database from the build directory, with the same environment used by the service,
and start the service:

```bash
cd /opt/capacitylens/apps/backend/build
sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
  -p WorkingDirectory=/opt/capacitylens/apps/backend/build \
  -p EnvironmentFile=/etc/capacitylens.env \
  -p Environment=NODE_ENV=production \
  /usr/bin/env node ace.js app:upgrade
sudo systemctl restart capacitylens
```

If nginx serves the site from a copy of `packaging/release/capacitylens.nginx.conf`, compare that
copy with the new tag's file and copy over any changed `location` blocks before starting the
service. Upgrades never replace it, and its `location` blocks keep secret-bearing invitation and
password-reset paths out of the access log. Invitation paths are `/api/invitations/<token>/...` and
`/invitation/<token>`; an older copy logs the tokens in them.

For an existing database, `app:upgrade` writes and verifies an online pre-upgrade backup before
running `migration:run --force --no-schema-generate`. A fresh database is initialised without a
pre-upgrade backup. The upgrade fails if a migration fails or if any migration this release ships
is still unrecorded afterwards. Do not start the new service after a failed upgrade; retain the source database and recovery files and investigate the
reported refusal.

After a successful upgrade, check `/health/ready`. Keep the backup until the
new release has passed sign-in, reads, writes and backup checks. Pre-upgrade backups are kept
separately from daily/manual retention; copy them off-host and keep the needed recovery points.

## Restore beta planning into a fresh installation

A full beta-native JSON export can move planning without upgrading the source database. While
the source still runs, sign in as its Owner and download **Export JSON** from **Settings → Data and
support → Import and export**. Keep the file unchanged and preserve the source database.

Follow [Install without Docker](/self-hosting/install-without-docker) with a new database path,
bootstrap a new Owner and create the destination company. As that Owner, select **Import JSON**,
preview the full file and confirm **Replace data** with your destination password. The imported
name, supported settings and scheduling records replace the initial company data; its company ID
and sign-in records remain local. Scheduling IDs and relationships are preserved. Reinvite members
and establish their person links as needed.

Check all imported records and settings, make an allocation edit, and reload before retiring the
source installation. This imports only full `capacitylens-beta` version `2` documents. It does
not convert alpha exports or migrate authentication. Redacted and malformed documents are refused.

## Databases that cannot be upgraded

Startup and the operator commands refuse a database that has not recorded every migration this
release ships, with a `Database schema drift` message; run `app:upgrade` to apply them. They do
not compare the schema itself. A database created before the move to password-only sign-in, or
before a later change to the baseline schema such as the invitation `scope` column or the Access
Control memberships table, records the same baseline, so it passes that check but cannot be
upgraded in place. Start a fresh database instead:

1. Stop the service and keep the old database file where it is.
2. Point `CAPACITYLENS_DB` at a new, unused path.
3. Run `node ace.js app:upgrade` to initialise it, then start the service.
4. Print a setup link with `node ace.js account-kit:admission:bootstrap <owner-email> --role=viewer`
   and send it to the Owner, who recreates the company and invites everyone again.

## Member-view state

The database backup includes current member-view control state and lifecycle events. A restored
mode still has its original deadline and must pass current credential and company-access checks.
Scheduling exports do not contain this control data.

## Roll back

Migrations are forward-only; there are no down migrations. To roll back an application release,
stop the service and restore the verified pre-upgrade backup to a separate database path, check out
and build the earlier tag, then point `CAPACITYLENS_DB` at that restored copy before starting it. Preserve the
upgraded database and all recovery files until the rollback is confirmed.

See [Backups and restore](/self-hosting/backups-and-restore) for backup handling and
[Monitoring](/self-hosting/monitoring) for readiness checks.
