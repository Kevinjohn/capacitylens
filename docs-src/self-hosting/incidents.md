---
title: When something goes wrong
description: Symptom-led guidance for account compromise, corrupted records, a locked-out Owner and other CapacityLens incidents.
---

# When something goes wrong

This page is organised by what you're seeing, not by subsystem. Find the symptom closest
to your situation, and follow its fix. Most of these procedures need the server stopped
— stopping it early costs you a few minutes of downtime and prevents a repair from racing
live traffic.

::: warning Running these commands under Docker
The recovery commands below (`pnpm --filter capacitylens-server ...`) are written for a
git checkout with the full workspace installed. The packaged `api` runtime image does
**not** contain them: its production build strips `pnpm`, `npm` and every dev-only
dependency (including `tsx`, which these scripts need), leaving only the compiled
server. Running them with `docker compose exec api ...` or `docker compose run api ...`
fails because the tools aren't there.

The supported path for a Docker installation is to run these commands from a git
checkout on the host, mounting the same named data and backup volumes, with the stack stopped:

1. Stop the stack so nothing else writes to the database while you work:
   `docker compose stop`.
2. From a checkout of the release currently running (matching tag or commit — these
   scripts assume the schema that release produces), start a throwaway container that
   has Node and pnpm — not the stripped-down `api` image — with the checkout and both
   named volumes mounted:

   ```bash
   docker run --rm -it \
     -v capacitylens_capacitylens-db:/data \
     -v capacitylens_capacitylens-backups:/backups \
     -v "$PWD":/workspace -w /workspace \
     node:24-bookworm-slim bash
   ```

   (Adjust the volume name for your install's Compose project prefix — see
   [Upgrades](/self-hosting/upgrades#one-time-check-for-older-compose-installations) if
   you're not sure it's `capacitylens_capacitylens-db`.)

3. Inside that container, install dependencies once (`corepack enable && pnpm install
   --frozen-lockfile`) and run the documented command against `/data/capacitylens.db`,
   for example `pnpm --filter capacitylens-server recover:audit-outbox -- inspect
   /data/capacitylens.db`. Preserve `/data/capacitylens.db-wal`,
   `/data/capacitylens.db-shm`, `/data/capacitylens-audit.jsonl` and its `.1` rotation
   alongside the database before investigating. Scheduled snapshots live under
   `/backups`; use the [named-volume restore procedure](/self-hosting/backups-and-restore#docker-compose-named-volume-procedure)
   when a verified snapshot is needed. A procedure that uses the `sqlite3` command-line
   tool directly needs it installed in the same container first: `apt-get update &&
   apt-get install -y sqlite3`.
4. Exit the container and restart the stack with `docker compose up -d` once you've
   confirmed the fix.
   :::

::: warning Running these commands on a managed VPS
The activated managed-VPS release also omits pnpm, `tsx` and development dependencies. Use the
[separate maintenance checkout procedure](/self-hosting/managed-vps/deploy-and-upgrade-safely#keep-operator-tooling-in-a-separate-maintenance-checkout)
at the exact active tag or commit. Keep that checkout outside release directories, stop the API
before a repair, and target the persistent database and evidence paths explicitly. Do not reinstall
development dependencies into `current/` or start another API from the maintenance checkout.
:::

## Suspected account or session compromise

**Symptom**: unexpected sign-ins, a leaked credential, or any reason to believe an
account or session is no longer trustworthy.

**Fix**:

1. Restrict public access at the proxy.
2. Preserve the database with its `-wal`/`-shm` sidecars, the `0600`-mode current and
   rotated audit files, forwarded security events and relevant proxy logs, without
   altering the originals. For Docker Compose, use the [stopped-volume preservation
   step](/self-hosting/backups-and-restore#preserve-compose-files), mount the
   installation's actual database and backup volumes, and write the evidence to a
   separate protected destination; do not copy a host path or only the database file.
3. Use the member/session revocation control in Team & access for a contained identity
   incident. Rotate provider credentials and `SMALLSASS_ACCOUNT_SECRET` only when every
   local session must be invalidated at once — that rotation signs everyone out.
4. Review memberships, invitations, session-revocation and audit events.
5. Keep access restricted until the integrity review is complete. Record the recovery
   decision against the preserved evidence before re-enabling access.
6. Follow your organisation's notification and disclosure obligations.

## A leaver or compromised company-login identity

**Symptom**: someone who signed in through company login needs to be cut off
immediately — an offboarded employee, or a compromised upstream identity.

**Cause**: disabling the identity at your company login provider stops a _new_ sign-in, but it
doesn't revoke a local session CapacityLens already issued. Without local revocation, an
actively used session stays valid up to its fixed twelve-hour lifetime; an inactive one
expires after thirty minutes. Signing out of CapacityLens also only ends the local
session — it doesn't promise to end the browser's session at the company login provider.

**Fix**:

1. Disable the identity and revoke provider sessions at your company login provider.
2. In Team & access, revoke that person's local sessions. Do this in every affected
   CapacityLens installation — one installation's revocation doesn't propagate to others.
3. Review provider identities, memberships, outstanding invitations, the account audit
   log and provider logs. Don't correlate or merge identities by email address alone.
4. For a broader compromise, restrict the proxy, rotate the affected provider client secret and the
   local `SMALLSASS_ACCOUNT_SECRET`, then require everyone to sign in fresh. Coordinate
   the rotation — changing the local secret signs out every session at once.
5. Record the actual containment time against the twelve-hour/thirty-minute maximum
   above; near-immediate cross-session logout isn't implemented yet, so don't describe
   this posture as instant global revocation.

## The sole Owner has lost their password

**Symptom**: a password-mode instance's only active Owner can't sign in, and there's no
second Owner to help.

**Cause**: this is by design, not a bug — admins can never administer an Owner's
credential, the exactly-one-active-Owner rule means no second Owner exists to help, and
there's deliberately no public password-reset endpoint. Restoring from backup doesn't
help either, since the backup holds the same credential the Owner can't produce. The
supported path is an operator-run CLI that drives the same reset ceremony a self-service
reset would use — same token store, 24-hour expiry, single use, same password policy and
session revocation — and never writes a credential directly.

**Fix**:

1. Preserve the database file with its `-wal`/`-shm` companions and record checksums,
   exactly as for the audit-outbox recovery below.
2. Stop the application process. The tool also takes SQLite's exclusive lock and refuses
   to run if any other process still holds the database — the `--confirm-server-stopped`
   flag records your intent, the lock enforces it.
3. Using the release that most recently started the database, with the instance's
   account environment present (`SMALLSASS_ACCOUNT_MODE=password-only`,
   `SMALLSASS_ACCOUNT_SECRET`, `SMALLSASS_ACCOUNT_PUBLIC_URL`), run:

   ```bash
   pnpm --filter capacitylens-server reset:owner-password -- /absolute/path/to/capacitylens.db owner@example.com --confirm-server-stopped
   ```

4. The tool refuses to run for: a missing or ambiguous identity at that address; a target
   who isn't the sole active Owner of at least one company (anyone else has a normal
   in-product reset path); an older database schema, rather than migrating outside the
   normal backup ceremony; or any non-password account mode.
5. The single line of JSON output contains the reset link itself — that link _is_ the
   secret. Deliver it to the Owner over a channel you trust, and never store it in
   tickets or logs. The audit trail records `identity.owner_recovery_issued` with a
   ceremony digest, never the token.
6. Restart the application and confirm the audit event reaches its configured
   destination. The Owner opens the link, sets a new password (this revokes every
   existing session) and signs in.

## Membership changes fail with `nextOwnershipTransferRevision`

**Symptom**: changing a role or status, removing a member, or acting on an ownership
transfer fails. The server log says that `nextOwnershipTransferRevision` cannot advance safely — only
when the stored revision is exactly `9007199254740991` — or, for every other unusable
value, that the stored revision is not a non-negative integer.

**Cause**: a live ownership-transfer row has an unusable revision. A decimal string
whose numeric value is from `0` through `9007199254740990` can advance normally and is
not this incident. A value of `9007199254740991` is valid but exhausted. An empty value,
non-decimal characters, a negative value, or a larger number is corruption. CapacityLens
stops the whole membership transaction instead of guessing a successor and weakening
stale-request protection.

**Fix**: prefer restoring a verified snapshot when it contains the correct row and the
later writes you would lose are understood. There is no in-app transition for an
exhausted or corrupt live row. If restoring is not appropriate, follow [Recover a blocked
ownership transfer](/self-hosting/ownership-transfer-recovery) to rehearse and run the
guarded stopped-server command. It cancels only the exact request approved by the Owner;
it does not change any membership or invent a replacement revision.

If the company also has zero active Owners, this incident can be the cause: startup's
automatic owner repair can fail when it encounters that unusable revision. See [A company
has no Owner](#a-company-has-no-owner). Resolve the revision only through the ownership-
transfer recovery procedure first. If startup still leaves the company without an Owner,
follow the guarded owner-assignment procedure in [A company has no Owner](#a-company-has-no-owner).

## Malformed or corrupted audit outbox record

**Symptom**: startup won't reach the listener, or logs point at a problem in the audit
outbox.

**Cause**: a corrupt or manually altered oldest outbox payload fails closed rather than
being skipped.

**Fix**: never delete or update an outbox row with ad hoc SQL.

1. Stop the API, preserve the database together with its `-wal`/`-shm` files and both
   audit JSONL generations, and take checksums before you diagnose anything. Work only on
   a verified copy or snapshot of the stopped original.
2. Inspect the oldest row without printing its raw payload:

   ```sh
   pnpm --filter capacitylens-server recover:audit-outbox -- inspect /absolute/path/to/capacitylens.db
   ```

3. If it reports `valid`, don't quarantine it — investigate the audit sink instead. An
   `invalid-json` or `invalid-payload` result includes the exact row ID, byte count and
   SHA-256 digest. Escalate under your incident and audit-retention policy before
   disposing of that evidence.
4. With explicit approval, quarantine only that still-current malformed head:

   ```sh
   pnpm --filter capacitylens-server recover:audit-outbox -- quarantine /absolute/path/to/capacitylens.db expected-head-id /absolute/path/to/evidence.json
   ```

   This refuses a valid or already-changed head, and refuses to overwrite an existing
   evidence file. It creates a mode-`0600`, fsynced envelope containing the exact raw row
   and digest, then deletes that one row transactionally. Store the evidence bundle under
   your audit retention policy.

5. Restart the API and watch `audit`, `auditPending` and the JSONL destination until the
   backlog drains. Repeat inspection only if another, independently malformed head shows
   up.

## `CorruptAccountCommandStateError`, or command-status stuck at `reconciliation_required`

**Symptom**: an account command (one that crosses the local database and an identity
provider) returns a generic 500, with the server log naming
`CorruptAccountCommandStateError` and a command id — or its status stays at
`reconciliation_required`.

**Cause**: the provider outcome, or a compensating action, couldn't be proven. This is an
integrity incident, not a routine "operator review" case: the server leaves the raw row
untouched and won't fabricate missing coordinates.

**Fix**:

1. Stop retrying the command with a new idempotency key.
2. Inspect the account audit event and the `account_commands` repair coordinates, then
   verify the actual membership, session, reset-ceremony or provisional-identity state.
3. Complete or undo the intended effect using the normal administrative control. Record
   an incident/change reference — no credentials, tokens or personal data in it.
4. Stop the application process so the repair can't race a live command. Using the
   release that most recently started the database, close the repaired record with:

   ```sh
   pnpm --filter capacitylens-server exec tsx scripts/reconcile-account-command.ts /absolute/path/to/capacitylens.db application-id command-id operator-reference
   ```

   This stores only a SHA-256 digest of your operator reference, refuses records that
   aren't awaiting reconciliation, and refuses to run against an older schema rather than
   migrating outside the normal pre-migration backup ceremony.

5. Confirm the status is now `compensated`, keep the audit evidence, and retry only with
   a new command identity if the business operation is still needed.

Don't close a malformed-metadata row with the reconciliation CLI until its metadata has
been recovered from a known-good copy or every external effect has been established from
authoritative provider and audit evidence — except a legacy row whose `resultJson` is
genuinely SQL `NULL`, which is the explicit generic-review case.

## Erasure refuses with `TenantErasureIntegrityError`

**Symptom**: deleting a company fails with a generic API error, and the server log shows
`TenantErasureIntegrityError`.

**Cause**: a corrupt id-only product relationship would otherwise cascade into, or unbind
a row belonging to, another company.

**Fix**: treat this as an integrity incident. Stop the application, preserve a copy of
the database with its `-wal`/`-shm` sidecars and both audit-log generations, and write it
to a separate protected destination if the host is under pressure. Identify the reported
parent/child edge and send a private incident report containing only redacted metadata
(ids, table/relationship names, timestamps and checksums) through your approved incident
tracker or restricted operator evidence store. Repair the account labels or relationship
only against an authoritative source. Don't disable foreign-key enforcement, edit the
database with ad hoc SQL or delete the reported child row just to make erasure pass. If
a verified snapshot contains the correct edge and the later writes you would lose are
understood, use the [restore procedure](/self-hosting/backups-and-restore) instead of
guessing at a repair.

## A company has no Owner

**Symptom**: a company shows no Owner in Team & access, or startup logs a structured
security event about an ownership repair.

**Cause**: CapacityLens enforces one active Owner per company. A database index blocks a
second active Owner, and startup checks the membership invariant. During upgrade, an
ownerless company with active members may be repaired automatically by promoting the
highest-tier active member (breaking ties by membership age); if every active member is a
Viewer, a Viewer can be promoted. Each automatic promotion emits a structured security
event. For an ownerless company that still needs repair, a guarded stopped-server command
can assign an existing active member as Owner.

**Fix**:

1. If this appeared right after an upgrade, check the audit/security log for the
   automatic promotion event first. Confirm the promoted person is appropriate. If the
   company has an Owner but you need to change who holds that role, use the in-app
   [ownership transfer](/getting-started/roles-and-permissions#hand-the-company-to-someone-else).
2. If the company remains ownerless, preserve the database and audit logs and stop the
   server. While the deployment remains in `self-hosted-mixed` with
   `SMALLSASS_ACCOUNT_MODE=password-and-sso` and a company provider configured, assign an existing
   active member using the guarded repair command:

   ```bash
   pnpm --filter capacitylens-server cutover:repair -- /path/to/capacitylens.db \
     assign-workspace-owner <company-id> <member-email> --confirm-server-stopped
   ```

   The command refuses to run without the explicit stopped-server flag, takes an exclusive
   database lock, and verifies that the exact company has no active Owner and that the
   selected email resolves unambiguously to one of its active members. It records the
   change in the audit outbox and ends any pending ownership transfer for that company.
   If those checks do not match the incident, preserve the evidence and restore a compatible
   backup or escalate; do not edit the database by hand.
   The separate [Owner password recovery procedure](#the-sole-owner-has-lost-their-password)
   applies only when an existing sole Owner still exists but cannot sign in.
   [Ownership-transfer recovery](/self-hosting/ownership-transfer-recovery) only handles
   a pending transfer.

## Disk-full or a failed snapshot

**Symptom**: the API reports `SQLITE_FULL`, a snapshot is logged as `backup FAILED`,
deep health stays `degraded` or `pending`, or the host reports no free blocks or inodes.

**Fix**:

1. Stop write traffic before attempting any cleanup. For Compose, stop the API before
   touching its named volumes; for a direct install, stop the systemd service.
2. Preserve the database with its `-wal`/`-shm` sidecars, the current and rotated audit
   logs, and the latest known-good snapshot to separate protected or off-host storage.
   If the host is already full, do not try to create another local copy. Record `df -h`
   and `df -i` output and the exact health/log messages. Never delete the only known-good
   snapshot or truncate an audit log to make room.
3. Free space only from disposable material that is already retained elsewhere, such as
   an old release directory or a verified off-host copy of an older snapshot. Keep the
   configured retention policy; the storage-encryption setting is an advisory attestation,
   not a substitute for preserving evidence.
4. Confirm the database, audit and backup paths are writable, then restart the service and
   recheck deep health. Wait for one complete scheduled snapshot. If the next snapshot
   fails, the database reports an integrity error, or SQLite cannot reopen the database,
   stop the service and escalate as a data-integrity incident. Do not keep retrying writes
   or run ad hoc SQLite repairs; follow [Backups and restore](/self-hosting/backups-and-restore)
   and use a verified snapshot only after the data loss boundary is understood.

## What's next

- [Monitoring and health checks](/self-hosting/monitoring) for the signals that catch
  most of these before they become incidents.
- [Backups and restore](/self-hosting/backups-and-restore) for the restore drill several
  of these fixes rely on.
