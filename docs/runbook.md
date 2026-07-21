# Operations runbook

## Health and logs

`GET /api/health` is unauthenticated, constant-work and deliberately exempt from rate limiting so
API traffic cannot starve the public uptime probe. With `CAPACITYLENS_HEALTH_DEEP=1`, it runs a
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
the collector. External forwarding is optional for community self-hosting: without it, local audit
and process logs remain available and startup emits a posture warning.

## Backups

When `CAPACITYLENS_BACKUP_DIR` is set, the server uses SQLite's online backup operation at boot and
on the configured interval. Do not `cp` a live WAL database.

When an existing database needs a schema migration, startup always writes and verifies a separate
`capacitylens-pre-migration-vN-to-vM-*.db` snapshot before applying DDL. It uses
`CAPACITYLENS_BACKUP_DIR` when configured and otherwise the database directory. Failure to create,
permission or pass `quick_check` on this snapshot refuses startup. These rollback snapshots are not
part of rolling retention: keep the matching file until the upgraded release has been verified,
then remove it deliberately under the deployment's retention policy.

The process applies a restrictive `0077` umask and enforces mode `0600` on database, WAL/SHM,
audit and snapshot files plus `0700` on the snapshot directory. Treat broader ownership or ACLs as
configuration drift. The production storage-encryption acknowledgement is valid only when the
underlying database, audit and backup storage is actually encrypted.

The on-host snapshot directory protects against some application/operator mistakes but not loss of
the host. For disaster recovery, optionally copy it to a separate account, region or provider using
restic, rclone, rsync or equivalent; encrypt the destination and monitor snapshot freshness.

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

For an application rollback after a schema upgrade, stop the API, preserve the failed/upgraded file
for diagnosis, restore the matching pre-migration snapshot with no stale WAL/SHM sidecars, and start
the previous image. Never point the previous image at the upgraded database: downgrade refusal is
intentional, and CapacityLens has no down migrations.

## Migration release rehearsal

Before a schema-bearing release, maintainers run `pnpm run rehearse:migrations` against the
committed auth fixture and again with `--source /path/to/representative.db`. The source is copied
with SQLite's online backup API and is never migrated. The temporary copy is anonymised and vacuumed
before use, then deleted unless `--keep` is explicit. A passing rehearsal proves the happy path,
verified rollback snapshot, migration-ledger checksum, injected disk-exhaustion rollback, forced
process-termination recovery and idempotent reopen for that source shape. Record the source schema
version, row/table counts printed by the command and the result in the release evidence; the command
never prints tenant content.

## Incident containment

For suspected account or session compromise:

1. Restrict public access at the proxy.
2. Preserve database, 0600 audit files, forwarded security events and relevant proxy logs without
   altering originals.
3. Use the member/session revocation control for a contained identity incident; rotate provider
   credentials and `SMALLSASS_ACCOUNT_SECRET` when all local sessions must be invalidated.
4. Review memberships, invitations, session-revocation and audit events.
5. Patch/upgrade, restore only if integrity requires it, then re-enable access.
6. Follow applicable notification and disclosure obligations.

### Hosted OIDC leaver or compromised upstream identity

IdP disablement prevents a new sign-in but does not revoke a local session already issued by a
product. Without local revocation, a continuously active session can remain valid until its fixed
twelve-hour expiry; an inactive one expires after thirty minutes. Product sign-out also ends only
the local session and does not promise to end the browser's provider session.

For a leaver or upstream compromise:

1. Disable the identity and revoke provider sessions at the IdP.
2. In every affected product installation, use Team & access to revoke that local principal's
   sessions. Do not assume one product's local revocation propagates to siblings.
3. Review `(issuer, subject)`, memberships, outstanding invitations, account audit and provider
   logs. Do not correlate or merge identities by email.
4. For broad compromise, restrict the proxy, rotate the OIDC client secret and local account secret,
   then require fresh sign-in. Coordinate rotation because changing the local secret invalidates all
   product sessions.
5. Record the actual containment time against the twelve-hour/thirty-minute maximum.

Near-immediate back-channel logout is not currently implemented. It is a mandatory architecture
revisit before hosted GA; do not describe the current posture as instant global revocation.

### Account command reconciliation

Account commands that cross the local database and an identity provider may enter
`reconciliation_required` when the provider outcome or a compensation cannot be proven. The
browser command-status endpoint returns only status and a redacted repair kind; workspace,
target-principal, provisional-principal and ceremony coordinates remain operator-only in the local
ledger/CLI path. Neither surface returns a bearer token.

1. Stop retrying the command with a new idempotency key.
2. Inspect the account audit event and the `account_commands` repair coordinates, then verify the
   actual membership, session, reset-ceremony or provisional-identity state.
3. Complete or undo the intended effect using the normal administrative control. Record an
   incident/change reference without credentials, tokens or personal data.
4. Stop the application process so the repair cannot race live command execution. Using the same
   release that most recently started the database, close the repaired record with:
   `pnpm --filter capacitylens-server exec tsx scripts/reconcile-account-command.ts <database> <application-id> <command-id> <operator-reference>`.
   The tool stores only a SHA-256 digest of the operator reference, refuses records that are no
   longer awaiting reconciliation, and refuses an older schema rather than running migrations
   outside the normal pre-migration backup ceremony.
5. Confirm the status is now `compensated`, retain the audit evidence and retry only with a new
   command identity if the business operation is still required.

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
  deploy, smoke test and retain a rollback image. For schema-bearing releases, retain the migration
  rehearsal result with the release evidence.
- After auth/crypto changes: exercise enrollment, recovery-code storage, session revocation,
  password-reset invalidation and the password-breach-service outage path in staging. For strict
  OIDC, also run issuer/audience/signature/key-rotation tests and `pnpm run e2e:oidc` against the
  pinned reference provider.

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
provider/library HTTP lifecycle; monitor provider latency and 5xx responses. Strict OIDC fails
closed on discovery, JWKS or user-info outage and has no unbounded application retry loop. Disable an
unstable named social provider; investigate strict-OIDC availability with the IdP operator.

An uncaught exception or unhandled rejection emits a `process_failure` security event, drains the
API and exits non-zero. Compose restarts it automatically. Alert on every such event and on restart
loops; preserve the full local operational error, verify health/data integrity and investigate the
underlying defect instead of treating restart as remediation.
