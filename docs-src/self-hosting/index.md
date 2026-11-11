---
title: Install and run CapacityLens
description: Install the native CapacityLens archive, configure HTTPS and backups, and hand the service to its Owner.
prev: false
next: false
---

# Install and run CapacityLens

CapacityLens runs as one Node process and stores company data in SQLite. These steps are for
whoever manages your hosting. That person also handles backups, upgrades and service health.
The expected installation is the native release archive with an HTTPS proxy on the same machine.

1. **Download** and unpack the archive for your host.
2. **Run** its install command with your domain name. It configures the service, secrets, HTTPS
   at a same-machine Caddy and backups, then prints the setup link.
3. **Open** the link and complete sign-in and company naming in the browser.

[Install without Docker](/self-hosting/install-without-docker) gives the exact Linux commands and
the manual steps;
[Deploy on a managed host](/self-hosting/managed-vps/) explains the process-manager requirements.
Existing [Docker support](/self-hosting/install-with-docker) remains optional. A proxy in a
separate container or on another machine is not supported.

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
