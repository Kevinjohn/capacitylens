---
title: Install and run CapacityLens
description: The technical guide to installing, configuring, operating and recovering a self-hosted CapacityLens service.
prev: false
next: false
---

<span id="choose-an-installation-route"></span>
<span id="the-moving-parts"></span>
<span id="common-questions"></span>
<span id="what-s-next"></span>

# Install and run CapacityLens

This guide is for the technical person who puts CapacityLens on a server and keeps it healthy.
CapacityLens runs as a small web app and API behind TLS, storing everything in a single SQLite
file. Installation ends when the service works, storage survives a restart and the first Owner
has everything needed to create their company.

After handover, the same person, or a named operator, owns backups, upgrades, monitoring,
configuration changes and the recovery procedures that deliberately have no in-product override.
The routine minimum is tested backups, monitored health and disk space, supported upgrades, and
configuration changes through a reviewed restart, coordinated with an Owner or Admin when they
affect sign-in or members. Open the page that matches the task in front of you.

## Install

- [Install CapacityLens](/self-hosting/install): five steps from the release archive, on a
  managed host or a Linux host.
- [Deploy on a managed VPS platform](/self-hosting/managed-vps/) such as Forge, Ploi or RunCloud.
- [Install without Docker](/self-hosting/install-without-docker) on a Linux host with Node 24 and
  systemd.
- [Install with Docker](/self-hosting/install-with-docker) when your host already runs Docker and
  Docker Compose.
- [Configuration](/self-hosting/configuration): every environment variable, including sign-in and
  storage.
- [TLS and networking](/self-hosting/tls-and-networking): the certificate, proxy and network
  boundary to complete before anyone enters a password.
- [Verify and hand over](/self-hosting/verify-and-hand-over) to the first Owner and operator.
- [Try the demo](/getting-started/try-the-demo) if you need to inspect the product first. It does
  not install a persistent service.

## Operate

- [Backups and restore](/self-hosting/backups-and-restore): start here if operational ownership
  has just been handed to you.
- [Upgrades](/self-hosting/upgrades) to another release.
- [Monitoring and health checks](/self-hosting/monitoring) for health, storage and certificates.
- [Company login](/company-login/): set up Google or Microsoft sign-in, or move an existing team
  to it.
- [Recover a blocked ownership transfer](/self-hosting/ownership-transfer-recovery).
- [When something goes wrong](/self-hosting/incidents) for diagnosis and recovery.
- [Install and operations FAQ](/self-hosting/faq).
