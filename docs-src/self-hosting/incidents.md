---
title: When something goes wrong
description: Preserve data and credentials while diagnosing a CapacityLens service, database, backup or Owner-access incident.
---

# When something goes wrong

Preserve the database and logs before attempting recovery. Stop the service before changing release
files, restoring a database or running an offline operator command. Never use ad hoc SQL to change
account, membership, audit or migration records.

## The service is not ready

Check `/health/live` and `/health/ready` separately. If liveness fails, inspect the service manager
for startup errors and restart loops. If readiness fails, verify database path and permissions,
released migration history, available disk space and backup-directory access. Do not expose
diagnostic details publicly.

## A backup failed or the disk is full

Keep the service available only if its database remains safe to write. Check free space and
permissions for `CAPACITYLENS_BACKUP_DIR`. Do not delete the only known-good snapshot to clear
space. Copy a verified snapshot off-host, resolve the capacity issue, then run
`node ace.js db:backup` from `backend/` and check `/health/ready` again. For restoration, follow
[Backups and restore](/self-hosting/backups-and-restore).

## An upgrade failed

Do not start the new release after `node ace.js app:upgrade` refuses or fails. Preserve the current
database, the pre-upgrade snapshot and the service logs. Check whether the release accepts the
recorded migration manifest. Do not edit the migration ledger or retry over a partial destination.
Use [Upgrades](/self-hosting/upgrades) for rollback and recovery.

## Sole Owner password recovery

This applies only when `CAPACITYLENS_MODE` is `password-only` or `password-and-sso` and the sole
active Owner already has a local password. A Google-only `sso-only` Owner cannot use this command
to create local password credentials. Confirm the target is the sole active Owner, stop the service
and run the audited command from the release's `backend/` directory:

```bash
node ace.js owner:reset-password owner@example.com --confirm-server-stopped
```

The result contains a single-use recovery link. Deliver it privately, do not paste it into logs or
support reports, and never set a password with direct database edits. The command refuses if the
target is not the sole active Owner or the database is not safe for recovery.

## A sign-in provider is unavailable

Check the public URL, callback registration, complete Google client configuration and mail settings
when an email delivery flow is involved. Password and Google sign-in are supported; Microsoft is
deferred and GitHub is retired. Deterministic checks do not establish live provider acceptance.
Avoid changing provider settings until an operator has confirmed the intended recovery path.

## Preserve incident evidence

Record the release version, incident time, affected operation and redacted readiness output. Keep
the database and snapshots access-controlled. Do not share passwords, session tokens, invitation
links, reset links, raw customer data or unredacted request logs in public issues.
