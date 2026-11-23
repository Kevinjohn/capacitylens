---
title: Install CapacityLens
description: Clone CapacityLens at a release tag, build it and run it on a Linux host.
next:
  text: Install without Docker
  link: /self-hosting/install-without-docker
---

# Install CapacityLens

The current server is a single AdonisJS application. It serves the web app and API, stores data in
one SQLite database, and runs as one process. The documented installation is a clone of the
repository at a release tag, installed and built on the host.

You need a Linux host, Git, Node 24.19.0 or later within the 24.x line, a persistent data
directory and a public HTTPS address. A background process runs as a dedicated site user; keep the
database and backup directory outside the clone under that user's access. Managed platforms can
follow [Deploy on a managed host](/self-hosting/managed-vps/).

Whoever manages your hosting follows the steps in
[Install without Docker](/self-hosting/install-without-docker): clone at a tag,
`pnpm install --frozen-lockfile`, `pnpm run build`, then run under a process manager behind an
HTTPS proxy. The steps end by printing a one-time setup link. An operator who is also the Owner
opens it in a browser; otherwise the operator sends it privately to the Owner, who opens it. First
sign-in and company naming then happen in the browser, without stopping the service. Hosting
maintenance, backups and upgrades stay with that operator.

Use a TLS proxy on the same machine, forwarding to the loopback listener; see
[TLS and networking](/self-hosting/tls-and-networking). A proxy in a separate container or on a
separate machine is not supported for this installation. [Docker Compose support](/self-hosting/install-with-docker)
is the second installation page: each tagged release publishes images for it.
