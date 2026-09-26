---
title: Verify and hand over the installation
description: Check the service, give the first Owner safe setup instructions, and name the ongoing operator.
---

# Verify and hand over the installation

This final installation task proves that CapacityLens is ready and gives the Owner only
the information they need to begin.

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

- Managed VPS, and the final public check for every route:

  ```bash
  curl -fsS https://capacity.example.com/api/health
  ```

Each response must start with `{"ok":true`. Deep health should show a successful database
check, healthy audit state, and a completed backup with `lastSuccessAt`. Resolve a `503`,
degraded field or restart loop before handover.

Open the final HTTPS address in a private browser window. Confirm that the sign-in page
loads without a certificate warning and that refreshing a nested route does not return an
nginx `404`.

## 2. Prove storage survives a restart

Record the database, audit and backup paths from your chosen route. Restart only that API,
then repeat the health check:

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

For a managed VPS, use the platform's restart control and confirm its Supervisor process
returns to running. Check that the same database remains present and that the configured
backup directory contains a verified dated snapshot.

## 3. Hand over

Send the intended Owner the CapacityLens address, the correct sign-in route and the [Owner
setup guide](/owner/). Transfer the one-time setup token privately in password-capable mode; for
company login, pre-authorise the Owner's exact verified email.

After the Owner confirms they can sign in, remove `SMALLSASS_ACCOUNT_SETUP_TOKEN` from the
runtime environment when it was used, restart the API and confirm health again.

Name the ongoing operator. Give them the [Self-hosted operations guide](/operations/) and
confirm who owns backups, upgrades, monitoring and incidents.

Do not ask the Owner to follow installation documentation. Their work begins with
creating the company and appointing an Admin.

## What's next

Use the [Installation FAQ](/installation/faq), or move ongoing work to [Self-hosted
operations](/operations/).
