---
title: Verify and hand over
description: Check the service, give the first Owner safe setup instructions, and name the ongoing operator.
---

# Verify and hand over

Check the service survives a restart, then hand it to the Owner and name who runs it.

## 1. Check the running service

- Docker Compose:

  ```bash
  curl -fsS http://127.0.0.1:8080/api/health
  ```

- Linux host:

  ```bash
  curl -fsS http://127.0.0.1:8787/api/health
  ```

- Managed host: open `https://capacity.example.com/api/health` in a browser, with your own
  address.

- Every other route, through the proxy:

  ```bash
  curl -fsS https://capacity.example.com/api/health
  ```

Each response must start with `{"ok":true`, with a successful database check, healthy audit
state and a completed backup with `lastSuccessAt`. Resolve a `503`, a degraded field or a restart
loop before handover.

In a private browser window, the HTTPS address must load the sign-in page without a certificate
warning, and refreshing a nested route must not return an nginx `404`.

## 2. Prove storage survives a restart

Note the database, audit and backup paths. Restart only the API, then repeat the health check:

- Docker Compose:

  ```bash
  docker compose restart api
  ```

- Linux host:

  ```bash
  sudo systemctl restart capacitylens
  ```

  ```bash
  sudo systemctl is-active capacitylens
  ```

On a managed host, use the platform's restart control and confirm its Supervisor process returns
to running. The same database must still be there, and the backup directory must hold a verified
dated snapshot.

## 3. Hand over

1. If you are also the Owner, continue with [Set up your company](/owner/). Otherwise, send the
   Owner the address and [Set up your company](/owner/). In password-capable mode, send the
   one-time setup token separately and privately; for company login, pre-authorise the Owner's
   exact verified email. Don't send them installation documentation.
2. Once the Owner can sign in, remove `CAPACITYLENS_SETUP_TOKEN` from the runtime environment if
   it was used, restart the API and check health again.
3. Name the ongoing operator, give them [Install and run CapacityLens](/self-hosting/), and
   confirm who owns backups, upgrades, monitoring and incidents.

Next: [Backups and restore](/self-hosting/backups-and-restore) — get the snapshots off the server.
