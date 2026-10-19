---
title: Upgrades
description: Upgrade the native CapacityLens archive with a verified pre-migration snapshot and the Adonis migration command.
---

# Upgrade CapacityLens

Keep the database and backup directory outside versioned release folders. Before changing the
running code, read the release notes and confirm that a recent snapshot can be read. Use one
process and stop it before replacing files or running the migration command.

## Install the new release

Download the archive for the host's operating system and architecture. Verify its checksum, unpack
it next to the current release, and move the `current` link to the new version. Do not overwrite an
existing release folder.

## Upgrade the database

From the new release's `backend/` directory, with the same environment used by the service, run:

```bash
node ace.js app:upgrade
```

This command checks the released migration manifest. When migrations are pending on an existing
database, it writes and verifies an online pre-upgrade snapshot before running
`migration:run --force --no-schema-generate`. A fresh database is initialized without a pre-upgrade
snapshot. Unknown migration history or schema drift refuses the upgrade. Do not start the new
service after a failed upgrade; retain the source database and recovery files and investigate the
reported refusal.

The credential-storage upgrade preserves outstanding password-reset links, including links issued
by the earlier release. Stop the earlier service before upgrading: it cannot use the renamed reset
storage. Historical email-change records are retained without enabling an email-change journey.

After a successful upgrade, start the service and check `/health/ready`. Keep the snapshot until the
new release has passed sign-in, reads, writes and backup checks.

## Roll back

Released migrations are append-only. Do not run down migrations to roll back an application
release. If the database was upgraded, stop the service and restore the verified pre-upgrade
snapshot to a separate database path, then point `CAPACITYLENS_DB` at that restored copy before
starting the compatible earlier release. Preserve the upgraded database and all recovery files
until the rollback is confirmed. If no migration was pending, retain the original database and
restore the previous release link only when its manifest accepts that database.

See [Backups and restore](/self-hosting/backups-and-restore) for snapshot handling and
[Monitoring](/self-hosting/monitoring) for readiness checks.
