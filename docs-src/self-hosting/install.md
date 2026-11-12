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

You need a Linux host, Node 24.19.0 or later within the 24.x line, a persistent data directory and a
public HTTPS address. A background process runs as a dedicated site user; keep the database and
backup directory outside the versioned release folder under that user's access.
On a host with systemd and Caddy, one command inside the archive installs the service, HTTPS and
backups and prints the setup link; see [Install without Docker](/self-hosting/install-without-docker),
which also keeps the manual steps. Managed platforms can follow
[Deploy on a managed host](/self-hosting/managed-vps/).

Whoever manages your hosting runs the [install command](/self-hosting/install-without-docker#install-with-one-command)
or completes the [manual steps](/self-hosting/install-without-docker#install-by-hand). The last step
is to open the setup link. First sign-in and company naming then happen in the browser,
without stopping the service. Hosting maintenance, backups and upgrades stay with that operator.

Use a TLS proxy on the same machine, forwarding to the loopback listener; see
[TLS and networking](/self-hosting/tls-and-networking). A proxy in a separate container or on a
separate machine is not supported. Existing [Docker Compose support](/self-hosting/install-with-docker)
remains optional; it is not the expected installation route.
