---
title: Recover a blocked ownership transfer
description: Safely cancel one exhausted or corrupt ownership-transfer request with the guarded stopped-server recovery command.
---

# Recover a blocked ownership transfer

Use this when a membership change fails because an ownership-transfer revision is exhausted or
corrupt. You cancel exactly that request, rehearsing on a copy first, during a short maintenance
window.

## Before you start

::: warning Owner approval and rollback copy required
Do not continue without the current Owner's approval to cancel the exact request, a verified
rollback copy and an incident record. The command records the cancellation in the durable audit
outbox, but that record does not replace your protected operations log.
:::

You also need:

- Protected storage for the incident copy, rollback backup and rehearsal copy.
- The release that most recently started the database; the command refuses an older or partially
  migrated schema.
- On Docker, the stack stopped and a throwaway Node container, as in
  [Run recovery commands on Docker or a managed host](/self-hosting/incidents#run-recovery-commands-on-docker-or-a-managed-host).

## Steps

1. Confirm the incident: the server reports that `nextOwnershipTransferRevision` cannot advance
   safely (revision exactly `9007199254740991`) or that the stored revision is not a non-negative
   integer. A revision from `0` through `9007199254740990` is normal.

   If the company also has no active Owner, resolve the revision here first, then if still needed
   follow [A company has no Owner](/self-hosting/incidents#a-company-has-no-owner).

2. Get the current Owner's confirmation to cancel the named transfer. Without it, preserve the
   evidence and restore a known-good snapshot or escalate. Do not assign ownership with SQL.

3. Stop the API. Follow [What to back up](/self-hosting/backups-and-restore#what-to-back-up) to copy
   the database with its `-wal` and `-shm` files into a protected incident directory, and record
   checksums. Keep that evidence pristine. Then create and verify a standalone rollback backup:

   ```bash
   sqlite3 <database> ".backup '/secure/path/ownership-transfer-pre-repair.db'"
   ```

   ```bash
   sqlite3 -readonly /secure/path/ownership-transfer-pre-repair.db \
     "PRAGMA quick_check; PRAGMA foreign_key_check;"
   ```

   It must print `ok` and no foreign-key rows. Copy the backup to
   `/secure/path/ownership-transfer-rehearsal.db` or another rehearsal path; never rehearse on the
   evidence or production.

4. Inspect the rehearsal copy, with the company and request ids from the server log or account audit
   trail (never a name or email):

   ```bash
   pnpm --filter capacitylens-server recover:ownership-transfer -- inspect \
     /secure/path/ownership-transfer-rehearsal.db <company-id> <request-id>
   ```

   The JSON line names the company, request, participants, live state, the revision as a byte-safe
   `revisionHex` value, and whether it is `corrupt` or `exhausted`. It refuses an advanceable
   revision, a terminal or absent request, an unexpected schema and a database failing integrity
   checks. Confirm every field against the Owner's approval.

5. Rehearse the cancellation on the copy, pasting `state`, `initiatorUserId`, `targetUserId` and
   `revisionHex` exactly from the inspection:

   ```bash
   pnpm --filter capacitylens-server recover:ownership-transfer -- cancel \
     /secure/path/ownership-transfer-rehearsal.db <company-id> <request-id> \
     <expected-state> <expected-initiator-id> <expected-target-id> \
     <expected-revision-hex> --confirm-server-stopped
   ```

   It takes an exclusive database lock and changes one row only when company id, request id, live
   state, both participants and revision still match the inspection. It cancels the request and
   enqueues the audit event together; the JSON result includes the audit id. Then replace the
   rehearsal database from the standalone backup.

6. Start only after the rehearsal in step 5 succeeded; otherwise stop and escalate. Repeat steps 4
   and 5 on the stopped production database, inspecting it immediately before
   cancelling. Any refusal means something changed: preserve the new evidence and investigate.

7. Record the request id, company id, audit id, before-and-after checksums, the Owner's approval and
   the incident reference in your protected operations log.

8. Restart the API. Confirm deep health, sign-in, audit delivery and **Team & access**, then make
   the intended membership change. If ownership still needs to move, start a new transfer.

## Roll back

Keep the evidence and the standalone backup until the Owner has checked the membership list and
audit delivery is healthy. To roll back, stop the API, preserve the failed state separately, then
use the standalone backup as the source in the
[general restore procedure](/self-hosting/backups-and-restore#general-procedure). Remove the
production database's stale `-wal` and `-shm` files as that procedure requires; don't restore the
evidence sidecars over a different database generation.
