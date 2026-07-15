# Operations runbook

## Health and logs

`GET /api/health` is unauthenticated and rate limited. With `CAPACITYLENS_HEALTH_DEEP=1`, it runs a
constant SQLite readiness query and reports audit degradation; startup separately performs the full
foreign-key integrity check before accepting traffic. Monitor health through the same public proxy
users reach and do not expose the API container directly.

With Compose:

```bash
docker compose ps
docker compose logs --since=30m api
curl -fsS https://capacity.example.com/api/health
```

Treat repeated 401/403 as access events, 409 as write conflicts, 429 as rate limiting, and 5xx or
`audit: degraded` as operator alerts. Logs may contain identifiers and must follow your retention
policy.

The packaged nginx→API hop uses a private per-install CA and verified TLS 1.2/1.3. Check that the
one-shot `internal-tls` service exited zero, the API/web services are healthy, and the leaf remains
valid for the next 30 days:

```bash
docker compose ps --all
docker compose run --rm --entrypoint openssl internal-tls x509 \
  -in /tls/api.crt -noout -issuer -subject -checkend 2592000
```

Use a coordinated `docker compose up --build --force-recreate -d` for releases and certificate
renewal. Never expose port 8787, add a plaintext proxy fallback, or copy the CA private key out of
its root-only volume. A failed initializer or certificate verification is an availability alert;
do not bypass it to restore traffic.

The process emits typed `capacitylens.security` JSON events for authentication outcomes, CSRF and
authorization rejection, MFA gates, rate limiting, session revocation and server errors. Alert on
bursts and suspicious cross-account patterns; do not treat the absence of an application event as
proof that proxy or identity-provider traffic was benign.

With `CAPACITYLENS_AUDIT_STDOUT=1`, each audit record is also emitted as a one-line
`{"type":"capacitylens.audit",...}` envelope. Configure the container/platform collector to ship
these plus security events to a logically separate destination, alert on delivery gaps and enforce
the documented retention/access policy. The `CAPACITYLENS_SECURITY_LOG_FORWARDING=1` production
flag is an operator attestation that this external control exists; the application does not create
the collector.

## Backups

When `CAPACITYLENS_BACKUP_DIR` is set, the server uses SQLite's online backup operation at boot and
on the configured interval. Do not `cp` a live WAL database.

The process applies a restrictive `0077` umask and enforces mode `0600` on database, WAL/SHM,
audit and snapshot files plus `0700` on the snapshot directory. Treat broader ownership or ACLs as
configuration drift. The production storage-encryption acknowledgement is valid only when the
underlying database, audit and backup storage is actually encrypted.

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
2. Preserve database, 0600 audit files, forwarded security events and relevant proxy logs without
   altering originals.
3. Use the member/session revocation control for a contained identity incident; rotate provider
   credentials and `BETTER_AUTH_SECRET` when all sessions must be invalidated.
4. Review memberships, invitations, session-revocation and audit events.
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
- Every release: review the security workflow, SBOM and image scan; read the changelog, back up,
  deploy, smoke test and retain a rollback image.
- After auth/crypto changes: exercise enrollment, recovery-code storage, session revocation,
  password-reset invalidation and the password-breach-service outage path in staging.

## Service and overload limits

The API accepts at most 512 simultaneous sockets per process; excess connections are refused and
the proxy returns an upstream error for retry/backoff rather than opening an unbounded queue. Each
request and incomplete connection has a 30-second server timeout. SQLite uses one synchronous
connection per process, waits at most five seconds for a held write lock and then returns a surfaced
error. Run exactly one API process against a SQLite file.

Memory-expensive scrypt work is limited to two active operations plus sixteen queued operations.
HIBP range lookups are limited to eight active calls plus thirty-two queued calls, each with a
five-second timeout; overflow or upstream failure rejects password creation/change/reset closed.
The CSP collector accepts at most 64 KiB and logs at most twenty projected reports per request.
Configured OIDC/social exchanges remain bounded by the 512-request process ceiling and the
provider/library HTTP lifecycle; monitor provider latency and 5xx responses, and remove an unstable
experimental provider rather than adding an unbounded retry loop.

An uncaught exception or unhandled rejection emits a `process_failure` security event, drains the
API and exits non-zero. Compose restarts it automatically. Alert on every such event and on restart
loops; preserve the full local operational error, verify health/data integrity and investigate the
underlying defect instead of treating restart as remediation.
