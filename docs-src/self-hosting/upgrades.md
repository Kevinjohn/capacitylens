---
title: Upgrades
description: Upgrade the native CapacityLens archive with a verified pre-migration snapshot and the Adonis migration command.
---

# Upgrade CapacityLens

Keep the database and backup directory outside versioned release folders. Before changing the
running code, read the release notes and confirm that a recent snapshot can be read. Use one
process and stop it before replacing files or running the migration command.

## Upgrade with the install command

If you installed with the [install command](/self-hosting/install-without-docker#install-with-one-command),
verify and unpack the new archive next to the current release, then run the new release's command:

```bash
sha256sum -c capacitylens-X.Y.Z.tar.gz.sha256
sudo tar -xzf capacitylens-X.Y.Z.tar.gz -C /opt/capacitylens
sudo node /opt/capacitylens/capacitylens-X.Y.Z/install.mjs
```

It keeps `/etc/capacitylens.env`, stops the service, points `current` at the new release and runs
`app:upgrade`, which backs up the existing database before migrating. It starts the service again
only when the upgrade succeeds. After a failure the service stays stopped; read the refusal and see
[Roll back](#roll-back). The steps below are the same upgrade by hand.

## Install the new release

Download the archive for the host's operating system and architecture. Verify its checksum, unpack
it next to the current release, and move the `current` link to the new version. Do not overwrite an
existing release folder.

## Upgrade the database

From the new release's `backend/` directory, with the same environment used by the service, run:

```bash
node ace.js app:upgrade
```

For an existing database, this command writes and verifies an online pre-upgrade snapshot before
running `migration:run --force --no-schema-generate`. A fresh database is initialized without a
pre-upgrade snapshot. Schema drift refuses the upgrade. Do not start the new
service after a failed upgrade; retain the source database and recovery files and investigate the
reported refusal.

After a successful upgrade, start the service and check `/health/ready`. Keep the snapshot until the
new release has passed sign-in, reads, writes and backup checks. Pre-upgrade snapshots are kept
separately from daily/manual retention; copy them off-host and keep the needed recovery points.

## Restore beta planning into a fresh installation

A full beta-native JSON export can transfer planning without upgrading the source database. While
the source still runs, sign in as its Owner and download **Export JSON** from **Settings → Data and
support → Import and export**. Keep the file unchanged and preserve the source database.

Follow [Install without Docker](/self-hosting/install-without-docker) with a new database path,
bootstrap a new Owner and create the destination company. As that Owner, select **Import JSON**,
preview the full file and confirm **Replace data** with your destination password. The imported
name, supported settings and scheduling records replace the initial company data; its company ID
and sign-in records remain local. Scheduling IDs and relationships are preserved. Reinvite members
and establish their person links as needed.

Check all imported records and settings, make an allocation edit, and reload before retiring the
source installation. This transfers only full `capacitylens-beta` version `1` documents. It does
not convert alpha exports or migrate authentication. Redacted and malformed documents are refused.

## Databases the upgrade refuses

A database created before the move to password-only sign-in, or before a later change to the
baseline schema such as the invitation `scope` column or the Access Control memberships table,
cannot be upgraded in place: `app:upgrade`
and startup refuse it with a `Database schema drift` message. Start a fresh database instead:

1. Stop the service and keep the old database file where it is.
2. Point `CAPACITYLENS_DB` at a new, unused path.
3. Run `node ace.js app:upgrade` to initialize it, then start the service.
4. Print a setup link with `node ace.js account-kit:admission:bootstrap <owner-email> --role=viewer`
   and send it to the Owner, who recreates the company and invites everyone again.

## Member-view state

This upgrade ends existing member views. Their old tokens cannot continue a view; sign in and start
a new view if needed. Historical application audit remains intact. New lifecycle events use the
package event schema, without the old company ID or separate company-switch/sign-out reasons.
The database backup includes current member-view control state and lifecycle events. A restored
mode still has its original deadline and must pass current credential and company-access checks.
Scheduling exports do not contain this control data.

## Roll back

Migrations are forward-only; there are no down migrations. To roll back an application release,
stop the service and restore the verified pre-upgrade snapshot to a separate database path, then
point `CAPACITYLENS_DB` at that restored copy before starting the earlier release. Preserve the
upgraded database and all recovery files until the rollback is confirmed.

See [Backups and restore](/self-hosting/backups-and-restore) for snapshot handling and
[Monitoring](/self-hosting/monitoring) for readiness checks.
