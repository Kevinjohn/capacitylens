# Operations runbook

## Health and logs

`GET /api/health` is unauthenticated. With `CAPACITYLENS_HEALTH_DEEP=1`, it checks SQLite and reports
audit degradation. Monitor it through the same public proxy users reach.

With Compose:

```bash
docker compose ps
docker compose logs --since=30m api
curl -fsS https://capacity.example.com/api/health
```

Treat repeated 401/403 as access events, 409 as write conflicts, 429 as rate limiting, and 5xx or
`audit: degraded` as operator alerts. Logs may contain identifiers and must follow your retention
policy.

## Backups

When `CAPACITYLENS_BACKUP_DIR` is set, the server uses SQLite's online backup operation at boot and
on the configured interval. Do not `cp` a live WAL database.

The on-host snapshot directory is not a disaster-recovery backup. Copy it to a separate account,
region or provider using restic, rclone, rsync or equivalent. Encrypt the destination and monitor
both job success and age of the newest usable snapshot.

## Restore drill

Schedule this before launch and after material storage changes:

1. Stop the API cleanly and wait for it to exit.
2. Copy the live database and WAL/SHM sidecars somewhere safe for rollback.
3. Copy a selected `capacitylens-*.db` snapshot to the configured database path.
4. Remove stale `-wal` and `-shm` sidecars.
5. Start the API and check deep health.
6. Verify login, account list, recent expected data and a safe write.
7. Record snapshot time, result and recovery duration.

`server/src/restore.drill.test.ts` continuously exercises the core backup → corruption → restore
path, but it does not replace an operator drill with real storage and credentials.

## Incident containment

For suspected account or session compromise:

1. Restrict public access at the proxy.
2. Preserve database, audit and relevant proxy logs without altering originals.
3. Rotate provider credentials and `BETTER_AUTH_SECRET` (this invalidates sessions).
4. Review memberships, invitations and audit events.
5. Patch/upgrade, restore only if integrity requires it, then re-enable access.
6. Follow applicable notification and disclosure obligations.

For disk-full or snapshot failure, stop write traffic before attempting cleanup. Never delete the
only known-good snapshot.

## Erasure

Account deletion erases the live tenant and eligible identities, but existing audit/backup copies
remain. Apply the deployment's retention schedule to those copies and document legal holds. See
`docs/privacy.md`.

## Routine maintenance

- Weekly: inspect health, disk, backup freshness and security advisories.
- Monthly: apply OS/container/dependency updates and test login + restore in staging.
- Every release: read the changelog, back up, deploy, smoke test and retain a rollback image.
