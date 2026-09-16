---
title: Self-hosted operations FAQ
description: Answers to common questions about backups, upgrades, monitoring and recovery.
next: false
---

# Self-hosted operations FAQ

These answers cover recurring questions from people maintaining a running service.

## What should I monitor?

Monitor the public and deep health endpoints, database and backup freshness, disk space,
the audit log, certificate expiry, and restart behavior. Follow [Monitoring and health
checks](/self-hosting/monitoring) for the exact signals.

## Is a scheduled backup enough?

Only after you have verified that it is current, stored safely, and restorable. Follow
the restore rehearsal in [Backups and restore](/self-hosting/backups-and-restore).

## Can I upgrade by replacing the files and restarting?

Use the procedure for your installation route. It includes backup, version checks,
migrations, health verification, and rollback boundaries that a simple restart misses.

## Who handles member access problems?

An Owner or Admin handles invitations, roles, and ordinary member status. The operator
handles deployment configuration and the recovery procedures that deliberately have no
in-product override.

## Where do I change company-login settings?

Provider credentials and service mode are deployment configuration. Coordinate the
member-facing cutover with an Admin and follow [How sign-in works](/company-login/).

## What should I collect during an incident?

Record the time, affected action, health output, service and proxy logs, current release,
and the last known good state. Do not copy bearer tokens or private customer data into a report.

## What's next

Return to [Self-hosted operations](/operations/) or [choose another guide](/#choose-your-guide).
