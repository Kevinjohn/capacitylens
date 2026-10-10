---
title: Install and operations FAQ
description: Answers to common questions about installation routes, handover, backups, upgrades, monitoring and recovery.
next: false
---

# Install and operations FAQ

## Installation

### Do I need Docker?

No. The release archive runs on Node 24 alone, on a managed VPS platform or a Linux host.
Docker Compose is another way to install; follow only the prerequisites of the route you choose.

### Is the local demo an installation route?

No. The demo keeps temporary in-memory data for evaluation. Never use it for real scheduling
data.

### Which Node version should I use?

Node 24, installed so the service can run it. Don't rely on the machine's default Node: the
server stops at start-up on an older version and says so.

### Who chooses the company name and calendar rules?

The first Owner, following [Set up your company](/owner/). The installer hands over a working
service and the first-Owner sign-in.

### Who owns backups after installation?

Name an operator before handover. They follow [Backups and restore](/self-hosting/backups-and-restore),
monitor backup freshness and test recovery.

### Can I expose CapacityLens directly without TLS?

No. Never send credentials or session traffic over an unencrypted internet connection.
Follow [TLS and networking](/self-hosting/tls-and-networking) for the supported topology.

## Operations

### What should I monitor?

The public and deep health endpoints, database and backup freshness, disk space, the audit log,
certificate expiry and restart behaviour. [Monitoring and health
checks](/self-hosting/monitoring) lists the exact signals.

### How big does the SQLite file get?

The database stays small: companies, people, projects and allocations come to a few thousand
rows even for a large team. The audit log (JSONL, one entry per product-data change) is what
grows; the `CAPACITYLENS_AUDIT_MAX_MB` entry in
[Configuration](/self-hosting/configuration#the-database-and-backups) explains how it is capped
and rotated. Watch disk space as routine maintenance either way.

### Is a scheduled backup enough?

Only once you have verified that it is current, stored safely and restorable. Follow the
restore rehearsal in [Backups and restore](/self-hosting/backups-and-restore).

### Can I upgrade by replacing the files and restarting?

No. Follow [Upgrades](/self-hosting/upgrades) for your installation route. It includes the
backup, version checks, migrations, health verification and rollback boundaries a plain restart
misses.

### How do I move to a new host?

Take a backup on the old host, restore it on the new one, and repoint DNS once you've verified
sign-in and the account list. [Backups and restore](/self-hosting/backups-and-restore) covers
both halves, including the environment file the new host needs.

### Who handles member access problems?

An Owner or Admin handles invitations, roles and ordinary member status. The operator handles
deployment configuration and the recovery procedures that deliberately have no in-product
override.

### Where do I change company-login settings?

Provider credentials and service mode are deployment configuration. Coordinate the change with
an Admin and follow [Require company sign-in](/company-login/move-to-single-sign-on).

### What should I collect during an incident?

The time, affected action, health output, service and proxy logs, current release and the last
known good state. Do not copy bearer tokens or private customer data into a report.

### How do I uninstall completely?

For a Docker Compose install, stop the stack and remove its containers and named volumes.

::: warning This permanently deletes the installation data
The volume removal below destroys the database, audit log, scheduled backups and the
internal certificate. Confirm that you have a readable off-host backup and no restore
drill or incident still depends on these volumes before continuing. This data cannot be
recovered from Docker after the volumes are removed.
:::

```bash
docker compose down
docker volume rm capacitylens_capacitylens-db capacitylens_capacitylens-backups capacitylens_capacitylens-internal-tls
```

Adjust the `capacitylens_` prefix if `docker compose config` shows a different one (see
[Upgrades](/self-hosting/upgrades#one-time-check-for-older-compose-installations)).
CapacityLens writes nothing outside those volumes and the checkout directory, which you can
delete once you no longer need it.

Return to [Install and run CapacityLens](/self-hosting/).
