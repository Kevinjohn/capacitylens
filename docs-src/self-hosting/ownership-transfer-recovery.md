---
title: Recover a blocked ownership transfer
description: Safely cancel one exhausted or corrupt ownership-transfer request with the guarded stopped-server recovery command.
---

# Recover a blocked ownership transfer

Use this when a membership change fails because an ownership-transfer revision is exhausted or
corrupt. You cancel exactly that request, preserving evidence and rehearsing on a copy first.
Plan a short maintenance window: the production repair starts only after the rehearsal succeeds.

## Before you start

::: warning Owner approval and rollback copy required
Do not continue without the current Owner's approval to cancel the exact request, a verified
rollback copy and an incident record. The command records the cancellation in the durable audit
outbox, but that record does not replace your protected operations log.
:::

- Prepare protected storage for the incident copy, rollback backup and rehearsal copy.
- Use the release that most recently started the database. The recovery command refuses an
  older or partially migrated schema.
- On Docker, the packaged `api` image does not include `pnpm` or `tsx`. Keep the stack stopped
  and use a throwaway Node container with the same data volume, as described in
  [Run recovery commands on Docker or a managed host](/self-hosting/incidents#run-recovery-commands-on-docker-or-a-managed-host).

## Steps

1. Confirm that this is the revision incident. The server reports that
   `nextOwnershipTransferRevision` cannot advance safely only when the stored revision is
   exactly `9007199254740991`; every other unusable value reports that the stored revision
   is not a non-negative integer. A decimal revision from `0` through `9007199254740990`
   advances normally and is not this incident. An empty value, non-decimal characters, a
   negative value or a larger number is corrupt.

   If the company also has zero active Owners, this can be the cause: the automatic
   ownerless-workspace repair cancels any live transfer while promoting a new Owner, and fails
   with the same error when that transfer's revision is unusable. Resolve the revision here
   first. If startup still leaves the company without an Owner, follow the guarded
   owner-assignment procedure in
   [A company has no Owner](/self-hosting/incidents#a-company-has-no-owner).

2. Ask the current Owner to confirm that the named transfer should be cancelled. If the
   Owner cannot confirm it, preserve the evidence and restore a known-good snapshot or
   escalate the incident. Do not assign ownership with SQL.

3. Stop the API. Follow [What to back up](/self-hosting/backups-and-restore#what-to-back-up)
   to copy the database with its `-wal` and `-shm` files into a protected incident
   directory, then record checksums. Keep that file set pristine: it is evidence, not a
   working copy. While the API remains stopped, also create a standalone SQLite rollback
   backup and verify it:

   ```bash
   sqlite3 <database> ".backup '/secure/path/ownership-transfer-pre-repair.db'"
   ```

   ```bash
   sqlite3 -readonly /secure/path/ownership-transfer-pre-repair.db \
     "PRAGMA quick_check; PRAGMA foreign_key_check;"
   ```

   The verification must print `ok` and no foreign-key rows. Copy that standalone backup
   to a separate rehearsal path, for example
   `/secure/path/ownership-transfer-rehearsal.db`. Do not open the pristine incident file
   set or use the production database for rehearsal.

4. Inspect the rehearsal copy. Use the exact company and request ids from the structured
   server log or account audit trail, never a person's name or email address.

   ```bash
   pnpm --filter capacitylens-server recover:ownership-transfer -- inspect \
     /secure/path/ownership-transfer-rehearsal.db <company-id> <request-id>
   ```

   The single JSON line names the exact company, request, participants, live state, stored
   revision as a byte-safe `revisionHex` value and whether that revision is `corrupt` or
   `exhausted`. The command refuses an advanceable revision, a terminal or absent request,
   an old or unexpected schema, and a database that fails SQLite integrity checks. Confirm
   every field against the Owner's approval and the incident evidence.

5. Rehearse the cancellation against the copied database. Paste `state`,
   `initiatorUserId`, `targetUserId` and `revisionHex` from the inspection output exactly.
   The `hex:` encoding safely carries an empty value, a NUL byte, leading zeroes or text that
   resembles a command-line flag.

   ```bash
   pnpm --filter capacitylens-server recover:ownership-transfer -- cancel \
     /secure/path/ownership-transfer-rehearsal.db <company-id> <request-id> \
     <expected-state> <expected-initiator-id> <expected-target-id> \
     <expected-revision-hex> --confirm-server-stopped
   ```

   The command requires the stopped-server confirmation and an exclusive database lock.
   It changes one row only when company id, request id, live state, both participants and
   revision still match the inspection. It cancels the request and enqueues the audit
   event in one transaction, and its JSON result includes the audit id. Replace the rehearsal
   database from the standalone backup afterwards.

6. Repeat steps 4 and 5 against the stopped production database. Do not reuse the
   rehearsal result: inspect production immediately before cancelling. Any difference
   is a concurrent-change refusal; preserve the new evidence and investigate.

7. Record the request id, company id, audit id, before-and-after checksums, the Owner's
   approval and the incident reference in your protected operations log.

8. Restart the API. Confirm deep health, sign-in, audit delivery and **Team & access** work,
   then make the originally intended membership change in the application. If ownership
   still needs to move, start a new transfer; it receives a new request id and begins at
   revision `0`.

## Roll back

Keep both the pristine incident file set and the verified standalone rollback backup until
the Owner has checked the membership list and the audit destination is healthy. To roll back,
stop the API, preserve the failed state separately, then use the standalone backup as the
source database in the
[general restore procedure](/self-hosting/backups-and-restore#general-procedure). Remove the
production database's stale `-wal` and `-shm` files as that procedure requires; do not restore
the pristine evidence sidecars over a different database generation.
