---
title: When something goes wrong
description: Symptom-led guidance for account compromise, corrupted records, a locked-out Owner and other CapacityLens incidents.
---

# When something goes wrong

Find your symptom and follow its fix. Most fixes need the server stopped; stop it first so a repair
cannot race live traffic.

- Unexpected sign-ins, a leaked credential, or someone to cut off now:
  [Suspected compromise or a leaver](#suspected-compromise-or-a-leaver)
- The only Owner can't sign in:
  [The sole Owner has lost their password](#the-sole-owner-has-lost-their-password)
- Membership changes fail:
  [`nextOwnershipTransferRevision`](#membership-changes-fail-with-nextownershiptransferrevision)
- Startup stops on the audit outbox:
  [Malformed or corrupted audit outbox record](#malformed-or-corrupted-audit-outbox-record)
- `CorruptAccountCommandStateError` or `reconciliation_required`:
  [Account command needs reconciliation](#corruptaccountcommandstateerror-or-command-status-stuck-at-reconciliation-required)
- Deleting a company fails:
  [`TenantErasureIntegrityError`](#erasure-refuses-with-tenanterasureintegrityerror)
- A company shows no Owner: [A company has no Owner](#a-company-has-no-owner)
- `SQLITE_FULL` or `backup FAILED`:
  [Disk-full or a failed snapshot](#disk-full-or-a-failed-snapshot)

Recovery commands (`pnpm --filter capacitylens-server ...`) need a git checkout with the full
workspace installed. On Docker or a managed host, read
[Run recovery commands on Docker or a managed host](#run-recovery-commands-on-docker-or-a-managed-host)
first. The Owner password reset is the exception: the release archive carries its own tool.

## Run recovery commands on Docker or a managed host

The packaged `api` image and a managed-host release omit `pnpm`, `tsx` and development dependencies,
so `docker compose exec api ...` fails.

**Docker:**

1. Stop the stack: `docker compose stop`.
2. From a checkout of the release currently running (matching tag or commit), start a throwaway Node
   container with the checkout and both named volumes mounted:

   ```bash
   docker run --rm -it \
     -v capacitylens_capacitylens-db:/data \
     -v capacitylens_capacitylens-backups:/backups \
     -v "$PWD":/workspace -w /workspace \
     node:24-bookworm-slim bash
   ```

   Adjust the volume names to your Compose project prefix
   ([Upgrades](/self-hosting/upgrades#one-time-check-for-older-compose-installations) shows how to
   find it).

3. Before investigating, preserve `/data/capacitylens.db-wal`, `/data/capacitylens.db-shm`,
   `/data/capacitylens-audit.jsonl` and its `.1` rotation alongside the database. Install
   dependencies once with `corepack enable && pnpm install --frozen-lockfile`, then run the
   documented command against `/data/capacitylens.db`, for example
   `pnpm --filter capacitylens-server recover:audit-outbox -- inspect /data/capacitylens.db`.
   Snapshots are under `/backups`
   ([named-volume restore procedure](/self-hosting/backups-and-restore#docker-compose-named-volume-procedure)).
   For `sqlite3`, run `apt-get update && apt-get install -y sqlite3` first.
4. Once the fix is confirmed, exit the container and run `docker compose up -d`.

**Managed host:** use the
[separate maintenance checkout procedure](/self-hosting/managed-vps/#keep-operator-tooling-in-a-separate-maintenance-checkout)
at the exact active tag or commit, outside release directories. Stop the API first and target the
persistent database and evidence paths explicitly. Don't install development dependencies into
`current/` or start another API from that checkout.

## Suspected compromise or a leaver

<span id="suspected-account-or-session-compromise"></span>
<span id="a-leaver-or-compromised-company-login-identity"></span>

**Symptom**: unexpected sign-ins, a leaked credential, or a company-login user (a leaver, a
compromised upstream identity) must be cut off now.

**Cause**: disabling an identity at the provider blocks new sign-ins, not existing CapacityLens
sessions. An active session lasts up to its fixed twelve hours; an inactive one expires after thirty
minutes. Signing out of CapacityLens ends only its own session, not the session at the
company-login provider.

**Fix**:

1. For a suspected compromise, restrict public access at the proxy. Preserve, without altering, the
   database with its `-wal`/`-shm` sidecars, the `0600`-mode current and rotated audit files,
   forwarded security events and relevant proxy logs. On Docker Compose, use the
   [stopped-volume preservation step](/self-hosting/backups-and-restore#preserve-compose-files) with
   the actual database and backup volumes and a separate protected destination; don't copy a host
   path or only the database file.
2. For a company-login identity, disable it and revoke its sessions at the provider.
3. In **Team & access**, select **Revoke sessions** for the person in every affected installation.
4. Only if every session must end at once, rotate the affected provider client secret and
   `CAPACITYLENS_SECRET`; this signs everyone out.
5. Review identities, memberships, invitations, audit events and provider logs. Don't correlate or
   merge identities by email address alone.
6. Keep access restricted until the integrity review is complete, and record the recovery decision
   against the evidence before re-enabling it.
7. Follow your organisation's notification and disclosure obligations.

**Check**: record the actual containment time against the twelve-hour/thirty-minute maximum;
revocation isn't instant across sessions.

## The sole Owner has lost their password

**Symptom**: the only active Owner of a password-mode instance can't sign in.

**Cause**: Admins can't reset an Owner's credential and there's no public reset endpoint; a backup
holds the same credential. An operator tool issues a normal single-use, 24-hour reset link instead.

**Fix**:

1. Preserve the database file with its `-wal`/`-shm` companions and record checksums.
2. Stop the application. The tool refuses to run while another process holds the database.
3. Using the release that most recently started the database, with the instance's environment
   present, run the tool from the release archive. Native install (`--pipe` keeps the link out of
   the journal):

   ```bash
   sudo systemctl stop capacitylens
   sudo systemd-run --pipe --wait --quiet --uid=capacitylens -p EnvironmentFile=/etc/capacitylens.env /usr/bin/env node /opt/capacitylens/current/server/dist/reset-owner-password.mjs /var/lib/capacitylens/capacitylens.db owner@example.com --confirm-server-stopped; echo "exit status $?"
   ```

   A non-zero exit status means no link was issued; the message above it says why. Managed host,
   after stopping the background process, from the command box or a shell in the site's root folder:

   ```bash
   cd current && node --env-file=../.env server/dist/reset-owner-password.mjs /home/forge/capacitylens-data/capacitylens.db owner@example.com --confirm-server-stopped
   ```

   Source checkout or the Docker throwaway container:
   `pnpm --filter capacitylens-server reset:owner-password -- /absolute/path/to/capacitylens.db owner@example.com --confirm-server-stopped`
   with `CAPACITYLENS_MODE=password-only`, `CAPACITYLENS_SECRET` and `CAPACITYLENS_PUBLIC_URL` set.

4. The JSON output contains the reset link, and that link _is_ the secret. Deliver it over a channel
   you trust; never store it in tickets or logs.
5. Restart the application. The Owner opens the link, sets a new password (this revokes every
   existing session) and signs in.

The tool refuses a missing or ambiguous identity, anyone who isn't the sole active Owner of at least
one company (they have an in-product reset), an older schema and non-password modes.

**Check**: the audit event `identity.owner_recovery_issued` (a digest, never the token) reaches its
destination.

## Membership changes fail with `nextOwnershipTransferRevision`

**Symptom**: role, status, removal or ownership-transfer changes fail; the log says
`nextOwnershipTransferRevision` cannot advance safely, or the stored revision is not a non-negative
integer.

**Cause**: a live ownership-transfer row has an exhausted (`9007199254740991`) or corrupt revision.

**Fix**:

1. Restore a verified snapshot if it has the correct row and you accept losing later writes.
2. Otherwise follow
   [Recover a blocked ownership transfer](/self-hosting/ownership-transfer-recovery). It cancels
   only the request the Owner approves.
3. If the company also has no active Owner, resolve the revision first, then follow
   [A company has no Owner](#a-company-has-no-owner) if still needed.

**Check**: the originally intended membership change succeeds.

## Malformed or corrupted audit outbox record

**Symptom**: startup stops before listening, or logs point at the audit outbox.

**Cause**: the oldest outbox payload is corrupt or was altered, and fails closed.

**Fix**: never delete or update an outbox row with ad hoc SQL.

1. Stop the API. Preserve the database with its `-wal`/`-shm` files and both audit JSONL
   generations, and take checksums. Work only on a verified copy of the stopped original.
2. Inspect the oldest row; its raw payload isn't printed:

   ```sh
   pnpm --filter capacitylens-server recover:audit-outbox -- inspect /absolute/path/to/capacitylens.db
   ```

3. `valid`: don't quarantine; investigate the audit sink. `invalid-json` or `invalid-payload`: note
   the row ID, byte count and SHA-256 digest, and escalate under your incident and audit-retention
   policy.
4. With explicit approval, quarantine only that still-current malformed head:

   ```sh
   pnpm --filter capacitylens-server recover:audit-outbox -- quarantine /absolute/path/to/capacitylens.db expected-head-id /absolute/path/to/evidence.json
   ```

   It refuses a valid or already-changed head, and refuses to overwrite an existing evidence file.
   It saves the raw row and digest to a mode-`0600` evidence file, then deletes that one row. Retain
   the evidence under your audit policy.

5. Restart the API.

**Check**: `audit`, `auditPending` and the JSONL destination show the backlog draining. Inspect
again only if another malformed head appears.

## `CorruptAccountCommandStateError`, or command-status stuck at `reconciliation_required`

**Symptom**: an account command (one involving an identity provider) returns a generic 500 with
`CorruptAccountCommandStateError` and a command id in the log, or its status stays
`reconciliation_required`.

**Cause**: the provider outcome, or a compensating action, couldn't be proven. Treat it as an
integrity incident.

**Fix**:

1. Stop retrying the command with a new idempotency key.
2. Inspect the account audit event and the `account_commands` repair coordinates, then verify the
   actual membership, session, reset-ceremony or provisional-identity state.
3. Complete or undo the intended effect with the normal administrative control. Record an incident
   reference with no credentials, tokens or personal data.
4. Stop the application. Using the release that most recently started the database, close the
   repaired record:

   ```sh
   pnpm --filter capacitylens-server exec tsx scripts/reconcile-account-command.ts /absolute/path/to/capacitylens.db application-id command-id operator-reference
   ```

   It stores only a digest of your reference, and refuses records not awaiting reconciliation and an
   older schema.

**Check**: the status is `compensated`. Keep the audit evidence; if the operation is still needed,
retry with a new command identity.

Don't close a malformed-metadata row until its metadata is recovered from a known-good copy or every
external effect is established from provider and audit evidence. A legacy row whose `resultJson` is
SQL `NULL` is the exception.

## Erasure refuses with `TenantErasureIntegrityError`

**Symptom**: deleting a company fails with a generic API error, and the server log shows
`TenantErasureIntegrityError`.

**Cause**: a corrupt relationship would cascade into another company's data.

**Fix**:

1. Stop the application. Preserve the database with its `-wal`/`-shm` sidecars and both audit-log
   generations, to a separate protected destination if space is short.
2. Identify the reported parent/child edge. Report it through your approved incident tracker with
   redacted metadata only (ids, table names, timestamps, checksums).
3. Restore a verified snapshot with the correct edge
   ([restore procedure](/self-hosting/backups-and-restore)) if you accept losing later writes.
   Otherwise repair the relationship only against an authoritative source. Don't disable foreign
   keys, run ad hoc SQL or delete the child row to make erasure pass.

**Check**: deleting the company succeeds.

## A company has no Owner

**Symptom**: **Team & access** shows no Owner, or startup logs a security event about an ownership
repair.

**Cause**: the company lost its only active Owner. An upgrade may repair this by promoting the
highest-tier active member (oldest membership wins ties; a Viewer only if every active member is
one), logging a security event.

**Fix**:

1. After an upgrade, find the promotion event and confirm the promoted person is appropriate. To
   change who holds the role, use the in-app
   [ownership transfer](/getting-started/roles-and-permissions#hand-the-company-to-someone-else).
2. If the company remains ownerless, preserve the database and audit logs and stop the server. While
   the deployment remains in `self-hosted-mixed` with `CAPACITYLENS_MODE=password-and-sso` and a
   company provider configured, assign an existing active member:

   ```bash
   pnpm --filter capacitylens-server cutover:repair -- /path/to/capacitylens.db \
     assign-workspace-owner <company-id> <member-email> --confirm-server-stopped
   ```

   It refuses to run without `--confirm-server-stopped`, and takes an exclusive database lock. It checks
   the company has no active Owner and the email matches exactly one active member, then records
   the change in the audit outbox and ends any pending ownership transfer.

3. If those checks don't match the incident, preserve the evidence and restore a compatible backup
   or escalate; don't edit the database by hand.

**Check**: **Team & access** shows one Owner.

[Owner password recovery](#the-sole-owner-has-lost-their-password) is for an Owner who exists but
can't sign in; [ownership-transfer recovery](/self-hosting/ownership-transfer-recovery) only handles
a pending transfer.

## Disk-full or a failed snapshot

**Symptom**: `SQLITE_FULL`, `backup FAILED` in the log, deep health stuck at `degraded` or
`pending`, or no free blocks or inodes.

**Cause**: the host has run out of space or inodes, or a database, audit or backup path isn't
writable.

**Fix**:

1. Stop write traffic before any cleanup: stop the Compose API or the systemd service.
2. Preserve the database with its `-wal`/`-shm` sidecars, the current and rotated audit logs and the
   latest known-good snapshot to separate protected or off-host storage, never another copy on the
   full host. Record `df -h`, `df -i` and the exact health/log messages. Never delete the only
   known-good snapshot or truncate an audit log to make room.
3. Free space only from material already retained elsewhere, such as an old release directory or an
   older snapshot with a verified off-host copy. Keep the configured retention policy.
4. Confirm the database, audit and backup paths are writable, then restart the service.

**Check**: deep health recovers and one complete scheduled snapshot succeeds. If the next snapshot
fails, the database reports an integrity error, or SQLite cannot reopen the database, stop the
service and escalate as a data-integrity incident. Don't retry writes or run ad hoc SQLite repairs;
follow [Backups and restore](/self-hosting/backups-and-restore) once you know what data a verified
snapshot would lose.
