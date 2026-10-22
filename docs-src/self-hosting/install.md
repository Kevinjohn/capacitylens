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

Before opening the service to users, configure the secrets and public URL in a private environment
file, run `node ace.js app:upgrade` from the archive's `backend/` directory, then start the service.
The first-run page uses `CAPACITYLENS_SETUP_TOKEN` to create the first identity. Then stop the
service, initialize its company and Owner with `company:initialize`, remove the token and restart,
as described in [first-run setup](/self-hosting/install-without-docker#_5-complete-first-run-setup).
Configure an external proxy to terminate TLS and forward requests to the loopback listener; see [TLS and networking](/self-hosting/tls-and-networking).

The [Docker Compose guide](/self-hosting/install-with-docker) builds separate web and API images.
It runs the checked upgrade command before the API starts and keeps data in persistent volumes.
