---
title: Upgrades
description: How to upgrade a self-hosted CapacityLens instance safely, what happens to the database on a schema change, and how to roll back.
---

# Upgrades

CapacityLens upgrades in place: pull the new release, rebuild, and restart. Schema
changes are handled automatically and safely, with an automatic rollback snapshot taken
before anything changes. This page is the upgrade procedure and its rollback path.

::: warning
Always take a fresh backup immediately before upgrading, even though the server also
takes its own pre-migration snapshot automatically. See
[Backups and restore](/self-hosting/backups-and-restore).
:::

## One-time check for older Compose installations

If your installation was created before the Compose project name was pinned to
`capacitylens`, do this once, before your next upgrade. Identify the database volume
attached to the currently running API:

```bash
db_volume="$(docker inspect "$(docker compose ps -q api)" \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')"
printf 'Database volume: %s\n' "$db_volume"
```

If that name isn't `capacitylens_capacitylens-db`, take the prefix before
`_capacitylens-db` and add it to your existing `.env`, for example
`COMPOSE_PROJECT_NAME=capacity-v1`. Keep that override for the life of the install. After
pulling the new release, run `docker compose config` and confirm its three rendered
physical volume names carry the same historical prefix before starting anything. If more
than one candidate prefix exists, stop and identify the volume mounted by the old API
rather than guessing.

## Upgrade procedure

1. Take a fresh, explicit snapshot and keep it outside the release tree. A recent restore
   test proves the _procedure_ works — it isn't a current copy of live data, so keep an
   off-host copy too. See [Backups and restore](/self-hosting/backups-and-restore).
2. Confirm you have a recent, successful restore test on record.
3. Read `CHANGELOG.md` for migrations or breaking changes in the target release.
4. Pull the target tag and rebuild all three targets. For Compose:

   ```bash
   docker compose up --build --force-recreate -d
   ```

   Compose recreates each service in place, one at a time: the old `api` container is
   stopped before the new one starts, and `web` waits for the new `api` to report
   healthy before it's recreated in turn — so there's no window where two API versions
   hold the SQLite file open together. Expect a brief gap, seconds not minutes, where
   requests are refused or retried while the old process exits and the new one comes up;
   that's normal restart behavior, not data loss. Mixed-version writers — old and new API
   against the same database at once — are not supported, and if anything outside this
   procedure ever created that overlap, the migration ledger's per-step checksums and
   transactional writes are what stand between you and a corrupted schema, not this
   command. This step also reruns the internal certificate initializer and reloads the
   resulting identity into both long-running services.

5. On first start, if the database needs a schema upgrade, CapacityLens automatically
   creates and verifies a `capacitylens-pre-migration-vN-to-vM.db` snapshot before making
   any schema change. If that snapshot creation fails, startup refuses rather than
   proceeding — resolve the underlying storage or permissions problem rather than
   bypassing the snapshot.
6. Check API health, sign in, confirm account access, and make one safe write.
7. Keep the old container image and the recovery snapshot until you're satisfied the
   upgrade is good.

### Current schema changes

The release that adds Studio and Supplementary engagement advances the database through
schema v29 (the required resource engagement column), v30 (the optional company-wide
engagement-grouping preference), v31 (the company working-day selection), and v32 (the optional
repeat-series identity on allocations). Existing resources become Studio resources, an absent
grouping preference reads as on, existing companies receive the first five days of their configured
week, and existing allocations remain unlinked. No manual data edit is required. To roll back to an
older image, restore the automatic pre-migration snapshot as described below; do not remove the new
columns or edit the migration ledger by hand.

### Stored credential effects

Some releases change how CapacityLens stores credentials rather than the schema. When a
release begins encrypting OAuth/OIDC tokens at rest, tokens written in plaintext by an earlier
version keep working unchanged and are transparently re-encrypted the next time they are
refreshed — this is a content-only change with no database migration and no operator action.
Sign-in is unaffected. The `CHANGELOG.md` Security section calls out the specific release where
this applies.

## Roll back

Rollback means stopping the API, restoring the pre-migration snapshot this release
created (or, if there wasn't one, the explicit snapshot from step 1) with no stale
`-wal`/`-shm` files, then starting the old image again. An old image deliberately refuses
to start against an upgraded database — CapacityLens has no down migrations, so rollback
always means restoring the matching snapshot, not just switching images back.

For Docker Compose's named volumes, use the
[restore procedure in Backups and restore](/self-hosting/backups-and-restore#docker-compose-named-volume-procedure)
with the exact `capacitylens-pre-migration-vN-to-vM.db` filename, rather than copying
host paths — the database lives in a named volume, not on the host filesystem.

## Release-directory deployments

If your platform builds into versioned release directories and switches a stable
`current` symlink (Capistrano-style deploys, for example), coordinate that switch with
the running API process: build the new release while the existing process keeps serving
traffic, stop the process immediately before activating the new release and cleaning up
the old one, then restart it from the stable path and verify `/api/health`.

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

The source database is copied with SQLite's online backup API and is never itself
migrated; the temporary copy is anonymised, vacuumed, and deleted unless `--keep` is
passed. A passing rehearsal proves the happy path, the verified rollback snapshot, the
migration-ledger checksum, an injected disk-exhaustion rollback, recovery from a forced
process termination at the final pending migration, completion of the remaining chain
after reopening, and an idempotent reopen for that database shape. It never prints tenant
content — record the source schema version and row/table counts it prints, along with the
result, in your release evidence.

## What's next

- [Backups and restore](/self-hosting/backups-and-restore) for the restore drill this
  page's rollback path relies on.
- [Monitoring and health checks](/self-hosting/monitoring) to confirm the upgraded
  instance is healthy.
