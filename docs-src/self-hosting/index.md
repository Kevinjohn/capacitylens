---
title: Install and run CapacityLens
description: Install the native CapacityLens archive, configure HTTPS and backups, and hand the service to its Owner.
prev: false
next: false
---

# Install and run CapacityLens

CapacityLens runs as one Node process and stores company data in a SQLite database. The current
installation route uses a native release archive; the checked-in Docker files still describe the
retired server and are not validated for this application.

1. [Install the archive](/self-hosting/install-without-docker) on Linux or follow the
   [managed-host guide](/self-hosting/managed-vps/).
2. Configure the database, secrets and backup directory in a private environment file.
3. Put a trusted proxy in front to terminate HTTPS, run the database upgrade and start one service
   process.
4. Check readiness and complete first-run setup with the private setup token.
5. Remove the setup token and hand over the service and recovery procedures to its Owner.

Before handover, read [Configuration](/self-hosting/configuration),
[TLS and networking](/self-hosting/tls-and-networking), [Backups and restore](/self-hosting/backups-and-restore),
[Upgrades](/self-hosting/upgrades) and [Monitoring](/self-hosting/monitoring).

## Support

The operator owns backups, upgrades, service health, disk capacity and changes to sign-in settings.
For an incident, see [When something goes wrong](/self-hosting/incidents). For community help, see
[Get help](/open-source#get-help); do not include credentials, bearer links or private customer
data in a public report.

## Other ways to try CapacityLens

[Try the demo](/getting-started/try-the-demo) for temporary sample data. The demo is not an
installation route and must not hold production scheduling data.
