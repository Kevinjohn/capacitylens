---
title: Verify and hand over
description: Check native service readiness, persistence and backup recovery, and agree who maintains hosting.
---

# Verify and hand over

Before people use the installation, confirm that the service is stable, HTTPS reaches the
application, and its data survives a restart.

## Check the running service

From the host, check liveness and readiness through the public HTTPS address:

```bash
curl -fsS https://capacity.example.com/health/live
curl -fsS https://capacity.example.com/health/ready
```

Liveness only proves that the process answers. Readiness checks the database and its schema
integrity. Investigate a failing response before handover; verify backups separately.

## Confirm persistence and backups

Sign in with the setup token, create the first Owner and company, and make a harmless test change.
Restart the service, sign in again, and confirm the change remains. Check that a completed snapshot
exists under `CAPACITYLENS_BACKUP_DIR` and copy a protected snapshot off-host. Follow
[Backups and restore](/self-hosting/backups-and-restore) to validate recovery on an isolated path.

## Hand over access

Give the Owner the public address, browser setup instructions and the hosting operator's contact.
Send any setup token separately. It cannot be reused after the first identity exists; remove it at
the next routine configuration change. Agree who manages upgrades, backups, readiness monitoring
and sign-in configuration. These hosting duties need a technical operator; they do not become the
company Owner's responsibility simply because that person owns the company.
Do not send secrets through deployment logs or public support channels.
