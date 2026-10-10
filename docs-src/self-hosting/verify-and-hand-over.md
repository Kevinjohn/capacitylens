---
title: Verify and hand over the installation
description: Check the service, give the first Owner safe setup instructions, and name the ongoing operator.
---

# Verify and hand over the installation

## 1. Check the running service

Use the check for your route:

- Docker Compose:

  ```bash
  curl -fsS http://127.0.0.1:8080/api/health
  ```

- Direct Node:

  ```bash
  curl -fsS http://127.0.0.1:8787/api/health
  ```

- Managed VPS: open `https://capacity.example.com/api/health` in a browser, with your own
  address.

- The final public check for every other route:

  ```bash
  curl -fsS https://capacity.example.com/api/health
  ```

Each response must start with `{"ok":true`. Deep health should show a successful database
check, healthy audit state and a completed backup with `lastSuccessAt`. Resolve a `503`, a
degraded field or a restart loop before handover.

Open the HTTPS address in a private browser window. The sign-in page must load without a
certificate warning, and refreshing a nested route must not return an nginx `404`.

## 2. Prove storage survives a restart

Note the database, audit and backup paths for your route. Restart only the API, then repeat the
health check:

- Docker Compose:

  ```bash
  docker compose restart api
  ```

- Direct Node:

  ```bash
  sudo systemctl restart capacitylens
  ```

  ```bash
  sudo systemctl is-active capacitylens
  ```

On a managed VPS, use the platform's restart control and confirm its Supervisor process returns
to running. Check the same database is still there and the backup directory holds a verified
dated snapshot.

## 3. Hand over

Send the intended Owner the address, the sign-in route and the [Owner setup guide](/owner/). In
password-capable mode, send the one-time setup token privately; for company login,
pre-authorise the Owner's exact verified email.

Once the Owner can sign in, remove `CAPACITYLENS_SETUP_TOKEN` from the runtime environment if it
was used, restart the API and check health again.

Name the ongoing operator, give them [Install and run CapacityLens](/self-hosting/), and confirm
who owns backups, upgrades, monitoring and incidents. Don't send the Owner installation
documentation: their work starts with creating the company and appointing an Admin.

For ongoing work, see the [Install and operations FAQ](/self-hosting/faq) and the operations
pages under [Run it](/self-hosting/#run-it).
