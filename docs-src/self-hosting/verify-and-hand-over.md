---
title: Verify and hand over
description: Check the service, decide on account email, give the first Owner safe setup instructions, and name the ongoing operator.
---

# Verify and hand over

Check the service survives a restart, decide on email, then hand it to the Owner and name who
runs it.

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

## 3. Decide on account email

Decide before handover whether the server sends email.
[Account email](/self-hosting/configuration#account-email) has the five settings. Without it:

- Invitations are links the Owner or an Admin copies and sends themselves.
- **Forgot password?** is not offered. An Owner or Admin creates a reset link for a member with
  **Reset password** instead, and a sole Owner who loses their password needs
  [you](/self-hosting/incidents#the-sole-owner-has-lost-their-password).
- Microsoft company login cannot be set up; it needs account email.

## 4. Hand over

1. If you are also the Owner, continue with [Set up your company](/owner/). Otherwise, send the
   Owner the address, [Set up your company](/owner/) and how to reach you. If people sign in with
   a password, which is the default, send the one-time setup token separately and privately; for
   company login, pre-authorise the Owner's exact verified email. The Owner needs none of the
   installation pages.
2. Once the Owner can sign in, remove `CAPACITYLENS_SETUP_TOKEN` from the runtime environment if
   it was used, restart the API and check health again.
3. Name the ongoing operator, give them [Install and run CapacityLens](/self-hosting/), and
   confirm who owns backups, upgrades, monitoring and incidents. Health and backup alerts go to
   the operator, not the Owner.

## What the Owner can do without you

In the app, the Owner can set up the company, invite people and change roles, appoint Admins,
reset another member's password, export the company's data and transfer ownership.

Tell them to ask you for anything on the server: backups and restores, upgrades, sign-in and
email settings, an outage, and a lost password for the only Owner.

Next: [Backups and restore](/self-hosting/backups-and-restore) — get the snapshots off the server.
