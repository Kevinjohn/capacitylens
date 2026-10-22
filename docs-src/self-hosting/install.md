---
title: Install CapacityLens
description: Install the native AdonisJS release archive on a Linux host.
next:
  text: Install without Docker
  link: /self-hosting/install-without-docker
---

# Install CapacityLens

The current server is a single AdonisJS application. It serves the web app and API, stores data in
one SQLite database, and runs as one process. The native release archive is the installation
route documented for this application.

You need a Linux host, Node 24 within the supported 24.x line, a persistent data directory and a
public HTTPS address. A background process runs as a dedicated site user; keep the database and
backup directory outside the versioned release folder under that user's access.
The full procedure is [Install without Docker](/self-hosting/install-without-docker); managed
platforms can follow [Deploy on a managed host](/self-hosting/managed-vps/).

Whoever manages your hosting completes the [five installation steps](/self-hosting/install-without-docker).
The last step is to open the address. First sign-in and company naming then happen in the browser,
without stopping the service. Hosting maintenance, backups and upgrades stay with that operator.

Use a TLS proxy on the same machine, forwarding to the loopback listener; see
[TLS and networking](/self-hosting/tls-and-networking). A proxy in a separate container or on a
separate machine is not supported. Existing [Docker Compose support](/self-hosting/install-with-docker)
remains optional; it is not the expected installation route.
