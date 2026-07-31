# Operations runbook

## Health and logs

`GET /api/health` is unauthenticated, constant-work and deliberately exempt from rate limiting so
API traffic cannot starve the public uptime probe. With `CAPACITYLENS_HEALTH_DEEP=1`, it runs a
constant SQLite readiness query, reports audit recovery/degradation with its pending-row count and
surfaces the configured internal certificate's cached expiry. When scheduled backups are configured
it also reports their latched status and the most recent successful snapshot time; startup separately
performs the full foreign-key integrity check before accepting traffic. Monitor health through the
same public proxy users reach and do not expose the API container directly.

With Compose:

```bash
docker compose ps
docker compose logs --since=30m api
curl -fsS https://capacity.example.com/api/health
```

Treat repeated 401/403 as access events, 409 as write conflicts, 429 as rate limiting, and 5xx,
`audit: degraded`, a non-zero `auditPending`, `backup.status: degraded`,
`internalTls.status: expiring` or `internalTls.status: expired` as operator alerts. `expiring` begins
at the same 30-day boundary used by the initializer; renew before it reaches zero. Logs may contain
identifiers and must follow your retention policy.
Password hashing and breached-password checks use bounded queues. Entries waiting longer than five
seconds are shed, disconnected requests withdraw before execution, and both immediate overflow and
wait expiry emit a `password_security_queue_saturated` security event naming the queue and reason.
Alert on repeated events; they indicate sustained CPU or dependency pressure rather than bad
credentials.

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

Do not set `CAPACITYLENS_AUDIT=off` in production. The production posture guard refuses startup
rather than serving without the mandatory local mutation audit; use the bounded rotation setting
and the delivery/degradation procedure below to manage disk usage instead.

Product-mutation audit events first enter `capacitylens_audit_outbox` in the same SQLite transaction
as the data change. The server drains them in commit order to JSONL, fsyncs each line, and deletes a
row only after delivery. On restart it replays pending rows; the stable `auditId` makes local-file
replay idempotent if a crash happened after fsync but before deletion. A failed sink leaves rows
queued and reports `audit: degraded` plus the exact `auditPending` row count; alert and restore the
sink promptly because continued writes will grow the SQLite file. The degraded signal is
deliberately sticky for the process lifetime: after
repairing the path, permissions or free-space problem, restart the server so startup replays the
queued outbox progressively in bounded background pages. Deep health reports `audit: recovering`
with the remaining `auditPending` count until it returns to `audit: ok`. Forwarded stdout collectors
should deduplicate the same `auditId` if a
restart replays a record after local delivery. A complete recovery/incident bundle therefore
includes both the SQLite database (which may contain pending events) and the JSONL generations.
For product mutations, `changedFields` contains field names only, never values, and includes only
fields the caller requested whose sanitized, authorization-pinned result changed persisted state.
Rejected or normalized-away request fields therefore do not appear as completed changes.

The local active file and its single `.1` generation are each hard-bounded by
`CAPACITYLENS_AUDIT_MAX_MB`; rotation happens before the next complete JSONL line would exceed the
cap. An individual line larger than the cap is not truncated or written: delivery stays in the
SQLite outbox and deep health reports audit degradation. Preserve the database and raise the cap
before retrying rather than deleting the queued evidence. A generation already over the configured
cap (from an older build or a lowered setting) is likewise preserved and blocks new delivery until
the operator archives it safely or restores a sufficient cap.

### Malformed audit outbox recovery

A corrupt or manually altered oldest outbox payload fails closed and can prevent startup from
reaching the listener. Never delete or update an outbox row with ad hoc SQL. Stop the API, preserve
the database together with its `-wal` and `-shm` files and both audit JSONL generations, and take
checksums before diagnosis. Work only on the stopped original after a verified copy or snapshot is
safe.

Inspect the oldest row without printing its raw payload:

```sh
pnpm --filter capacitylens-server recover:audit-outbox -- inspect <database>
```

If it reports `valid`, do not quarantine it; investigate the audit sink instead. An `invalid-json`
or `invalid-payload` result includes the exact row ID, byte count and SHA-256 digest. Escalate under
the organisation's incident and audit-retention policy before disposing of that evidence. With
explicit approval, quarantine only that still-current malformed head:

```sh
pnpm --filter capacitylens-server recover:audit-outbox -- quarantine <database> <expected-head-id> <evidence-file>
```

The command refuses a valid or changed head and refuses to overwrite an existing evidence file. It
creates a mode-0600, fsynced envelope containing the exact raw row and digest before deleting that
one row transactionally. Store the evidence bundle under the audit retention/access policy. Restart
the API and monitor `audit`, `auditPending` and the JSONL destination until the retained suffix has
drained; repeat inspection only if another independently malformed head is exposed.

## Backups

The server explicitly configures SQLite WAL commits with `synchronous=FULL` and refuses startup if
the connection cannot report that policy. This defines the application's normal host-power-loss
boundary for acknowledged writes. It cannot protect against a filesystem, storage controller or
device that falsely reports completed flushes, or loss of the whole volume; retain off-host backups
and exercise restore drills.

When `CAPACITYLENS_BACKUP_DIR` is set, the server uses SQLite's online backup operation at boot and
on the configured interval. Do not `cp` a live WAL database. Before a scheduled snapshot receives
its final name or can trigger retention, the server verifies its `quick_check`, `foreign_key_check`
and copied schema version, then normalises it to one standalone DELETE-journal file. A failed check
is logged as `backup FAILED`, removes the unpublished temp artifact, and leaves every older restore
point untouched; investigate the live database or backup storage before relying on later attempts.
Deep health exposes `backup.status` and `backup.lastSuccessAt`; any failed snapshot latches the
status as `degraded` for the process lifetime while later successes continue advancing the timestamp.
Before retention begins, the server sets the completed snapshot's final permissions, syncs the
file, atomically renames it and syncs the containing directory. A failure in any publication
barrier rejects the attempt and skips retention. After removing old snapshots, it syncs the
directory again; failure there is logged as a retention warning because the new recovery point is
already durable and the safe power-loss outcome is that an older file may remain. These are the
standard host-filesystem durability boundaries, not a guarantee against storage that lies about
flush completion or loss of the entire volume.
Retention identifies and excludes the open main database by resolved path and filesystem identity,
even if it shares the snapshot directory and its basename resembles a snapshot. A separate snapshot
volume remains recommended so database and recovery artifacts have independent failure domains.
`CAPACITYLENS_BACKUP_KEEP` defaults to 48 and accepts values whose floor is between 1 and 10,000;
for compatibility, `100.5` retains 100 snapshots. Invalid, lower and over-maximum values use the
safe default. `CAPACITYLENS_BACKUP_INTERVAL_MIN` remains a whole-minute value.

When an existing database needs a schema migration, startup always writes and verifies a separate
`capacitylens-pre-migration-vN-to-vM.db` snapshot before applying DDL. Repeated attempts for the
same version pair refresh one stable filename. Before startup may enter forward-only DDL, it sets
the unpublished snapshot's final permissions, syncs that file, atomically renames it and syncs the
containing directory. Any barrier failure refuses the upgrade; do not bypass it. This is the
standard host-filesystem durability boundary, not a guarantee against storage hardware that lies
about flush completion or loses the entire volume, so retain off-host backups and restore drills.
The snapshot uses `CAPACITYLENS_BACKUP_DIR` when configured and otherwise the database directory.
Creation, verification, permission or durability-barrier failure refuses startup. These rollback
snapshots are not part of rolling retention: keep the matching file until the upgraded release has
been verified, then remove it deliberately under the deployment's retention policy.

A current-version file is still structurally validated before traffic starts. An unexpected
required product column, incompatible declared type or primary key, CHECK/UNIQUE constraint,
write trigger, STRICT mode or WITHOUT ROWID table is treated as physical schema drift and refuses
startup. Do not change `user_version`, the application id or the migration ledger to bypass that
failure. Preserve the database and logs, compare it with a verified snapshot, and repair or restore
the unexpected DDL while the API remains stopped. Nullable or defaulted extension columns are safe
and do not cause refusal because product writes use an explicit column list.

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
3. Copy a selected dated `capacitylens-utc-YYYYMMDD-HHMMSS-sss.db` scheduled snapshot to the
   configured database path. Do not select a `capacitylens-pre-migration-*` file here; those belong
   to the application-rollback procedure below.
4. Remove stale `-wal` and `-shm` sidecars.
5. Start the API and check deep health.
6. Verify login, account list, recent expected data and a safe write.
7. Record snapshot time, result and recovery duration.

### Docker Compose named-volume procedure

The packaged Compose deployment stores `/data` and `/backups` in named volumes. Run the following
from the checkout containing the active `.env` and `docker-compose.yml`; host-path `cp` commands do
not reach those volumes. The one-off helper uses the API image's normal unprivileged `node` user and
the same volume mounts as the stopped service, so restored files keep the ownership the API expects.

Before a restore, confirm `docker compose config` renders the physical volume prefix used by the
active installation. New deployments use `capacitylens_`. A pre-pin deployment may retain its
historical prefix through `COMPOSE_PROJECT_NAME` in `.env`; do not remove or change that override.
If an upgrade unexpectedly presents an empty instance, do not create a company or remove volumes.
Stop the new stack, list `docker volume ls`, restore the previous project prefix in `.env`, confirm
the rendered `*_capacitylens-db`, `*_capacitylens-backups` and `*_capacitylens-internal-tls` names,
then start the stack and verify the expected account list.

First stop the API, list the available snapshots and preserve the cleanly stopped live database in
the backup volume. The command fails before changing `/data` if no snapshot is present:

New snapshots use UTC-sortable names (`capacitylens-utc-YYYYMMDD-HHMMSS-sss.db`). Older
`capacitylens-YYYYMMDD-HHMMSS-sss.db` local-time snapshots remain valid restore inputs and remain
inside automatic retention until they age out.

```bash
docker compose stop api
docker compose run --rm --no-deps --entrypoint sh api -eu -c '
  ls -l /backups/capacitylens-*.db
  rollback_dir="/backups/manual-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  umask 077
  mkdir -m 700 "$rollback_dir"
  for file in /data/capacitylens.db /data/capacitylens.db-wal /data/capacitylens.db-shm; do
    test ! -e "$file" || cp -p "$file" "$rollback_dir/"
  done
  printf "Preserved stopped database files in %s\n" "$rollback_dir"
'
```

Choose an exact filename from that listing, then copy it to a temporary file in `/data`, verify its
mode and owner, atomically replace the live database and remove sidecars. The basename check keeps
the operator-supplied value inside `/backups`:

```bash
export RESTORE_SNAPSHOT=capacitylens-utc-YYYYMMDD-HHMMSS-sss.db
docker compose run --rm --no-deps -e RESTORE_SNAPSHOT --entrypoint sh api -eu -c '
  case "$RESTORE_SNAPSHOT" in
    capacitylens-*.db) ;;
    *) echo "RESTORE_SNAPSHOT must be a capacitylens-*.db basename" >&2; exit 1 ;;
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
docker compose up -d api
docker compose ps
curl -fsS https://capacity.example.com/api/health
```

Complete the login, account, recent-data and safe-write checks above before removing the preserved
`manual-restore-*` directory. If `CAPACITYLENS_DB` or `CAPACITYLENS_BACKUP_DIR` was deliberately
changed from the packaged paths, adapt and rehearse the procedure for those mounts before an
incident.

`server/src/restore.drill.test.ts` continuously exercises the core backup → corruption → restore
path, but it does not replace an operator drill with real storage and credentials.

For an application rollback after a schema upgrade, stop the API, preserve the failed/upgraded file
for diagnosis, restore the matching pre-migration snapshot with no stale WAL/SHM sidecars, and start
the previous image. Never point the previous image at the upgraded database: downgrade refusal is
intentional, and CapacityLens has no down migrations. Compose operators use the named-volume
procedure above with the exact `capacitylens-pre-migration-vN-to-vM.db` filename, then select and
start the retained previous image instead of the upgraded image.

## Migration release rehearsal

Before a schema-bearing release, maintainers run `pnpm run rehearse:migrations` against the
committed auth fixture and again with `--source /path/to/representative.db`. The source is copied
with SQLite's online backup API and is never migrated. The temporary copy is anonymised and vacuumed
before use, then deleted unless `--keep` is explicit. A passing rehearsal proves the happy path,
verified rollback snapshot, migration-ledger checksum, injected disk-exhaustion rollback, forced
process-termination recovery at the final pending migration, completion of the remaining chain after
reopen, and idempotent reopen for that source shape. Record the source schema
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

If command-status returns a generic 500 and the server log names
`CorruptAccountCommandStateError` plus the command id, stop the application and preserve the
database before doing anything else. Present malformed or incomplete repair metadata is an
integrity incident, not an `operator-review` default: the server leaves the raw row unchanged and
will not fabricate missing provisional-principal or ceremony coordinates. Do not close that row
with the reconciliation CLI until its metadata has been recovered from a known-good copy or every
external effect has been established from authoritative provider and audit evidence. A legacy row
whose `resultJson` is genuinely SQL `NULL` remains the explicit generic-review case.

For password invitation signup, the local user, credential link and command `targetPrincipalId`
commit in one SQLite transaction. An interruption before commit leaves no provisional identity; an
interruption after commit leaves the exact principal coordinate available to this reconciliation
procedure. The ledger never stores the submitted password or an independently testable verifier.

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

Erasure refuses to run when a corrupt id-only product relationship would cascade or unbind a row
labelled for another account. Treat the generic API failure plus the server-side
`TenantErasureIntegrityError` as an integrity incident: stop the application, preserve a copy of the
database, identify the reported parent/child edge, and repair the account labels or relationship
against an authoritative source before retrying. Do not disable foreign-key enforcement or delete
the reported child merely to make erasure pass.

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
error. Run exactly one API process against a SQLite file. On SIGTERM/SIGINT the daemon stops
accepting work and gives requests and background snapshots ten seconds to drain. If either remains
wedged it logs the deadline and force-exits non-zero without closing SQLite underneath live work;
the supervisor must allow more than ten seconds before SIGKILL and restart the failed process.

Memory-expensive scrypt work is limited to two active operations plus sixteen queued operations.
HIBP range lookups are limited to eight active calls plus thirty-two queued calls, each with a
five-second timeout. Scrypt overflow aborts password verification without producing a wrong-password
verdict, and overflow or upstream HIBP failure rejects password creation/change/reset closed.
These scrypt/HIBP queues are process-wide availability safeguards, not per-company reservations.
Password authentication is identity-global and occurs before company selection, so every company
on a multi-company instance shares them. The normal per-IP API limit remains the first admission
control. Use edge/global quotas or separate CapacityLens instances, each with its own database, when
adversarial isolation is required; do not weaken the memory bounds.
The CSP collector accepts at most 64 KiB and logs at most twenty projected reports per request.
Configured OIDC/social exchanges remain bounded by the 512-request process ceiling and the
provider/library HTTP lifecycle; monitor provider latency and 5xx responses. Strict OIDC fails
closed on discovery, JWKS or user-info outage and has no unbounded application retry loop. Disable an
unstable named social provider; investigate strict-OIDC availability with the IdP operator.

An uncaught exception or unhandled rejection emits a `process_failure` security event, drains the
API and exits non-zero. Compose restarts it automatically. Alert on every such event and on restart
loops; preserve the full local operational error, verify health/data integrity and investigate the
underlying defect instead of treating restart as remediation. If another stop arrives during a
drain, the forced-exit log includes `reason=signal:<name>` for an operator signal or
`reason=process_failure:<kind>` for a concurrent uncaught failure.
