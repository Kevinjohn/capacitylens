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
checkout on the host, mounting the same named data volume, with the stack stopped:

1. Stop the stack so nothing else writes to the database while you work:
   `docker compose stop`.
2. From a checkout of the release currently running (matching tag or commit — these
   scripts assume the schema that release produces), start a throwaway container that
   has Node and pnpm — not the stripped-down `api` image — with the checkout and the
   named data volume both mounted:

   ```bash
   docker run --rm -it \
     -v capacitylens_capacitylens-db:/data \
     -v "$PWD":/workspace -w /workspace \
     node:24-bookworm-slim bash
   ```

   (Adjust the volume name for your install's Compose project prefix — see
   [Upgrades](/self-hosting/upgrades#one-time-check-for-older-compose-installations) if
   you're not sure it's `capacitylens_capacitylens-db`.)

3. Inside that container, install dependencies once (`corepack enable && pnpm install
--frozen-lockfile`) and run the documented command against `/data/capacitylens.db`,
   for example `pnpm --filter capacitylens-server recover:audit-outbox -- inspect
/data/capacitylens.db`. A procedure that uses the `sqlite3` command-line tool directly
   needs it installed in the same container first: `apt-get update && apt-get install -y
sqlite3`.
4. Exit the container and restart the stack with `docker compose up -d` once you've
   confirmed the fix.
   :::

## Suspected account or session compromise

**Symptom**: unexpected sign-ins, a leaked credential, or any reason to believe an
account or session is no longer trustworthy.

**Fix**:

1. Restrict public access at the proxy.
2. Preserve the database, the `0600`-mode audit files, forwarded security events and
   relevant proxy logs, without altering the originals.
3. Use the member/session revocation control in Team & access for a contained identity
   incident. Rotate provider credentials and `SMALLSASS_ACCOUNT_SECRET` only when every
   local session must be invalidated at once — that rotation signs everyone out.
4. Review memberships, invitations, session-revocation and audit events.
5. Patch or upgrade, restore from backup only if data integrity actually requires it,
   then re-enable access.
6. Follow your organisation's notification and disclosure obligations.

## A leaver or compromised company-login (OIDC) identity

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
3. Review `(issuer, subject)` pairs, memberships, outstanding invitations, the account
   audit log and provider logs. Don't correlate or merge identities by email address
   alone.
4. For a broader compromise, restrict the proxy, rotate the OIDC client secret and the
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
   account environment present (`SMALLSASS_ACCOUNT_MODE=password`,
   `SMALLSASS_ACCOUNT_SECRET`, `SMALLSASS_ACCOUNT_PUBLIC_URL`), run:

   ```bash
   pnpm --filter capacitylens-server reset:owner-password -- <database> <owner-email> --confirm-server-stopped
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
transfer fails. The server log (or, for the `assign-workspace-owner` repair command, its
own console output) says that `nextOwnershipTransferRevision` cannot advance safely — only
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
exhausted or corrupt live row. If restoring is not appropriate, the narrow manual repair
below records the Owner's decision to cancel that one request. It does not change any
membership or invent a replacement revision.

If the company also has zero active Owners, this incident can be the *cause* of that one:
the automatic ownerless-workspace repair itself cancels any live transfer as part of
promoting a new Owner, and fails with the same error when that transfer's revision is
unusable. See [A company has no Owner](#a-company-has-no-owner) — resolve the exhausted
or corrupt revision here first, then let that repair (or the `assign-workspace-owner`
command) proceed.

::: warning
This procedure changes a production control record without producing an application
audit event. Do not continue without the current Owner's approval, a verified rollback
copy and an incident record.
:::

1. Ask the current Owner to confirm that the named transfer should be cancelled. If the
   Owner cannot confirm it, preserve the evidence and restore a known-good snapshot or
   escalate the incident. Do not assign ownership with SQL.
2. Stop the API. Follow [What to back up](/self-hosting/backups-and-restore#what-to-back-up)
   to copy the database with its `-wal` and `-shm` files into a protected incident
   directory, then record checksums. Keep that file set pristine: it is evidence, not a
   working copy. While the API remains stopped, also create a standalone SQLite rollback
   backup and verify it:

   ```bash
   sqlite3 <database> ".backup '/secure/path/ownership-transfer-pre-repair.db'"
   ```

   ```bash
   sqlite3 -readonly /secure/path/ownership-transfer-pre-repair.db "PRAGMA quick_check; PRAGMA foreign_key_check;"
   ```

   The verification must print `ok` and no foreign-key rows. Copy that standalone backup
   to a separate rehearsal path, for example `/secure/path/ownership-transfer-rehearsal.db`.
   Do not open the pristine incident file set or use the production database for rehearsal.
3. Open the rehearsal copy read-only with the SQLite command-line tool:

   ```bash
   sqlite3 -readonly /secure/path/ownership-transfer-rehearsal.db
   ```

4. Turn on headers and list the live requests. Identifiers and revisions are emitted as
   hexadecimal text so a damaged stored value is never pasted back into SQL. Match the
   affected company to the exact company id in the structured server log or account audit
   trail. Do not identify it by a person's name or email address.

   ```sql
   .headers on
   .mode box
   WITH live AS (
     SELECT *,
            CASE
              WHEN revision = '' OR instr(revision, char(0)) > 0 OR revision GLOB '*[^0-9]*' THEN 'corrupt'
              WHEN length(CASE WHEN ltrim(revision, '0') = '' THEN '0' ELSE ltrim(revision, '0') END) < 16
                THEN 'advanceable'
              WHEN length(CASE WHEN ltrim(revision, '0') = '' THEN '0' ELSE ltrim(revision, '0') END) > 16
                THEN 'corrupt'
              WHEN (CASE WHEN ltrim(revision, '0') = '' THEN '0' ELSE ltrim(revision, '0') END)
                   <= '9007199254740990' THEN 'advanceable'
              WHEN (CASE WHEN ltrim(revision, '0') = '' THEN '0' ELSE ltrim(revision, '0') END)
                   = '9007199254740991' THEN 'exhausted'
              ELSE 'corrupt'
            END AS revisionStatus
       FROM account_ownership_transfers
      WHERE state IN ('awaiting_target', 'awaiting_owner')
   )
   SELECT hex(id) AS requestIdHex, accountId, hex(accountId) AS accountIdHex,
          initiatorUserId, targetUserId, state, hex(revision) AS revisionHex,
          revisionStatus, createdAt, expiresAt, targetAcceptedAt
     FROM live
    ORDER BY accountId, createdAt, id;

   .parameter init
   .parameter set :account_id_hex "'COPIED_ACCOUNT_ID_HEX'"

   SELECT CASE
            WHEN length(:account_id_hex) > 0
             AND length(:account_id_hex) % 2 = 0
             AND upper(:account_id_hex) NOT GLOB '*[^0-9A-F]*'
              THEN 'hex-ok'
            ELSE 'STOP-invalid-hex'
          END AS accountParameter;

   SELECT COUNT(*) AS liveRequests
     FROM account_ownership_transfers
    WHERE hex(accountId) = upper(:account_id_hex)
      AND state IN ('awaiting_target', 'awaiting_owner');

   SELECT COUNT(*) AS activeMembers,
          SUM(CASE WHEN role = 'owner' THEN 1 ELSE 0 END) AS activeOwners
     FROM account_members
    WHERE hex(accountId) = upper(:account_id_hex) AND status = 'active';

   PRAGMA quick_check;
   PRAGMA foreign_key_check;
   .quit
   ```

   Enter only the hex characters copied from the first query. Continue only when the
   parameter reports `hex-ok`, there is exactly one live request, exactly one active
   Owner, `quick_check` returns `ok`, and `foreign_key_check` returns no rows. Confirm that
   the request participants and state agree with the Owner and the audit trail. If
   `revisionStatus` is `advanceable`, close the read-only handle without changing anything
   and investigate the original error.
5. Close the read-only rehearsal handle, then reopen
   `/secure/path/ownership-transfer-rehearsal.db` read-write with `sqlite3`. Set
   three parameters from its inspection output. Each value must contain an even number of
   hexadecimal characters and nothing outside `0-9` and `A-F`; only the revision hex may
   be empty. Stop if any value fails that manual check or the query below reports anything
   except `hex-ok` three times. For an empty revision hex, enter
   `.parameter set :revision_hex "''"`.

   ```sql
   .bail on
   .headers on
   .mode box
   .parameter init
   .parameter set :request_id_hex "'COPIED_REQUEST_ID_HEX'"
   .parameter set :account_id_hex "'COPIED_ACCOUNT_ID_HEX'"
   .parameter set :revision_hex "'COPIED_REVISION_HEX'"

   WITH parameters(name, value) AS (VALUES
     ('request_id_hex', :request_id_hex),
     ('account_id_hex', :account_id_hex),
     ('revision_hex', :revision_hex)
   )
   SELECT name,
          CASE
            WHEN (name = 'revision_hex' OR length(value) > 0)
             AND length(value) % 2 = 0
             AND upper(value) NOT GLOB '*[^0-9A-F]*'
              THEN 'hex-ok'
            ELSE 'STOP-invalid-hex'
          END AS status
     FROM parameters;

   BEGIN IMMEDIATE;

   UPDATE account_ownership_transfers
      SET state = 'cancelled',
          terminalAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          terminalReason = 'owner_cancelled'
    WHERE hex(id) = upper(:request_id_hex)
      AND hex(accountId) = upper(:account_id_hex)
      AND hex(revision) = upper(:revision_hex)
      AND state IN ('awaiting_target', 'awaiting_owner');

   SELECT changes() AS changedRows;
   SELECT hex(id) AS requestIdHex, hex(accountId) AS accountIdHex, state,
          hex(revision) AS revisionHex, terminalAt, terminalReason
     FROM account_ownership_transfers
    WHERE hex(id) = upper(:request_id_hex)
      AND hex(accountId) = upper(:account_id_hex);
   PRAGMA quick_check;
   PRAGMA foreign_key_check;
   ```

   On the rehearsal copy, type `ROLLBACK;` even when every check passes, then type `.quit`.
   Reopen it read-only and repeat step 4. The live request must be back in its original
   state and all integrity results must be unchanged. Replace the rehearsal copy from the
   standalone backup if you need to try again.
6. Only after the rehearsal succeeds, open the stopped production database read-write
   with `sqlite3 <database>` and repeat the complete parameter, transaction, update and
   verification block from step 5. Do not commit unless `changedRows` is exactly `1`, the
   row is now `cancelled`, the revision hex is unchanged, `quick_check` returns `ok`, and
   `foreign_key_check` returns no rows. The bad revision deliberately survives unchanged on
   the now-terminal row — it is inert there and safe to leave, since a terminal row is
   never advanced or reused. Type `ROLLBACK;` and `.quit` if any check differs.
   Otherwise type `COMMIT;`, then repeat the selected-company and integrity queries from
   step 4. Expect `liveRequests` to be `0`, the active-member and active-Owner counts to be
   unchanged, `quick_check` to return `ok`, and `foreign_key_check` to return no rows.
   Type `.quit` to close the production handle.
7. Record the request id, company id, before-and-after checksums, the Owner's approval and
   the incident reference in your protected operations log. This direct repair does not
   emit an application audit event, so do not omit that record.
8. Restart the API. Confirm deep health, sign-in and Team & access work, then perform the
   originally intended membership change through the application. If ownership still
   needs to move, start a new transfer; it receives a new request id and begins at
   revision `0`.

Keep both the pristine incident file set and the verified standalone rollback backup
until the Owner has checked the membership list and the audit destination is healthy. If
you must roll back, stop the API, preserve the failed state separately, then use the
standalone backup as the source database in the [general restore
procedure](/self-hosting/backups-and-restore#general-procedure). Remove the production
database's stale `-wal` and `-shm` files as that procedure requires; do not restore the
pristine evidence sidecars over a different database generation.

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
   pnpm --filter capacitylens-server recover:audit-outbox -- inspect <database>
   ```

3. If it reports `valid`, don't quarantine it — investigate the audit sink instead. An
   `invalid-json` or `invalid-payload` result includes the exact row ID, byte count and
   SHA-256 digest. Escalate under your incident and audit-retention policy before
   disposing of that evidence.
4. With explicit approval, quarantine only that still-current malformed head:

   ```sh
   pnpm --filter capacitylens-server recover:audit-outbox -- quarantine <database> <expected-head-id> <evidence-file>
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
   pnpm --filter capacitylens-server exec tsx scripts/reconcile-account-command.ts <database> <application-id> <command-id> <operator-reference>
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
the database, identify the reported parent/child edge, and repair the account labels or
relationship against an authoritative source before retrying. Don't disable foreign-key
enforcement or delete the reported child row just to make erasure pass.

## A company has no Owner

**Symptom**: a company shows no Owner in Team & access, or startup logs a structured
security event about an ownership repair.

**Cause**: CapacityLens enforces exactly one active Owner per company two ways — a
database index that blocks a second one from ever being created, and a boot check that
refuses to start with a member-bearing company that has zero Owners. If an existing
company reaches startup with no Owner (only possible through legacy data, an import, or
a hand-edited database), migration repairs it automatically: it promotes that company's
highest-tier active member, breaking ties by whoever has been a member longest, and
promotes a Viewer only if every active member is a Viewer. Every automatic promotion
like this emits a structured security event so an operator can review it.

**Fix**:

1. If this appeared right after an upgrade, check the audit/security log for the
   automatic promotion event first — the migration has usually already fixed it. Confirm
   the promoted person is the right one; if not, use the in-app [ownership
   transfer](/getting-started/roles-and-permissions#hand-the-company-to-someone-else) to
   move it to the right person (that's the only ordinary ownership-change operation —
   Owner can never be assigned through an invite or a regular role change). It needs the
   nominated Admin to agree, so it is not an instant fix; the repair command below is
   what to reach for when nobody can act as Owner at all.
2. If a company still has no Owner and the automatic repair doesn't apply (for example,
   mid SSO cutover), use the stopped-server `assign-workspace-owner` repair command
   documented under [Cutover repair
   commands](/company-login/move-to-single-sign-on#a-company-with-no-owner). It promotes
   one existing active member you name by exact company id and email, takes an exclusive
   lock, and records an operator audit event with the change. This repair also cancels any
   live ownership transfer for that company; if it fails with the error described in
   [Membership changes fail with `nextOwnershipTransferRevision`](#membership-changes-fail-with-nextownershiptransferrevision),
   resolve that transfer's revision first, then retry.

## Disk-full or a failed snapshot

Stop write traffic before attempting any cleanup. Never delete the only known-good
backup snapshot — see [Backups and restore](/self-hosting/backups-and-restore) for what a
failed snapshot attempt does and doesn't affect.

## What's next

- [Monitoring and health checks](/self-hosting/monitoring) for the signals that catch
  most of these before they become incidents.
- [Backups and restore](/self-hosting/backups-and-restore) for the restore drill several
  of these fixes rely on.
