---
title: Install and operations FAQ
description: Answers to common questions about installation routes, handover, backups, upgrades, monitoring and recovery.
next: false
---

# Install and operations FAQ

## Installation

### Do I need Docker?

No. The release archive runs on Node 24 alone, on a managed host or a Linux host.
Docker Compose is an alternative; follow only the prerequisites of your route.

### Is the local demo an installation route?

No. The demo keeps temporary in-memory data. Never use it for real scheduling data.

### Which Node version should I use?

Node 24, installed where the service can run it, not the machine's default Node. The server
stops at start-up on an older version and says so.

### Who chooses the company name and calendar rules?

The first Owner, following [Set up your company](/owner/). The installer hands over a working
service and the first-Owner sign-in.

### Who owns backups after installation?

An operator you name before handover. They follow
[Backups and restore](/self-hosting/backups-and-restore), monitor backup freshness and test
recovery.

### Can I expose CapacityLens directly without TLS?

No. Never send credentials or session traffic unencrypted over the internet. Follow
[TLS and networking](/self-hosting/tls-and-networking).

## Operations

### What should I monitor?

Health, backup freshness, disk space, the audit log, certificate expiry and restarts.
[Monitoring and health checks](/self-hosting/monitoring) lists the exact signals.

### How big does the SQLite file get?

It stays small: a few thousand rows even for a large team. The audit log (one entry per
product-data change) is what grows; `CAPACITYLENS_AUDIT_MAX_MB` in
[Configuration](/self-hosting/configuration#the-database-and-backups) caps and rotates it. Watch
disk space either way.

### Is a scheduled backup enough?

Only once it is copied off-host, current and proven restorable. Follow
[Backups and restore](/self-hosting/backups-and-restore).

### Can I upgrade by replacing the files and restarting?

No. Follow [Upgrades](/self-hosting/upgrades): it covers the backup, version checks,
migrations, health verification and rollback a plain restart misses.

### How do I move to a new host?

Back up the old host, restore on the new one, and repoint DNS once sign-in and the company list
work. [Backups and restore](/self-hosting/backups-and-restore) covers both, including the
environment file the new host needs.

### Who handles member access problems?

An Owner or Admin handles invitations, roles and member status. The operator handles deployment
configuration and the recovery procedures that have no in-product override.

### Where do I change company-login settings?

In the deployment configuration. Coordinate the change with an Admin and follow
[Require company sign-in](/company-login/move-to-single-sign-on).

### What should I collect during an incident?

The time, affected action, health output, service and proxy logs, current release and last known
good state, without bearer tokens or private customer data.

### How do I uninstall completely?

For Docker Compose, stop the stack and remove its containers and named volumes.

::: warning This permanently deletes the installation data
The volume removal below destroys the database, audit log, scheduled backups and the
internal certificate, and Docker cannot recover them. First confirm you have a readable
off-host backup and no restore drill or incident still depends on these volumes.
:::

```bash
docker compose down
docker volume rm capacitylens_capacitylens-db capacitylens_capacitylens-backups capacitylens_capacitylens-internal-tls
```

Adjust the `capacitylens_` prefix if `docker compose config` shows a different one (see
[Upgrades](/self-hosting/upgrades#one-time-check-for-older-compose-installations)).
CapacityLens writes nothing outside those volumes and the checkout directory, which you can then
delete.

The same backup check applies to the other routes. For a release-archive install on a Linux host,
stop and disable the service, then delete `/etc/systemd/system/capacitylens.service`,
`/opt/capacitylens`, the data folder `/var/lib/capacitylens` and `/etc/capacitylens.env`, and remove
the site from Caddy or nginx. On a managed host, delete the background process, the site and its
data folder, such as `/home/forge/capacitylens-data`.
