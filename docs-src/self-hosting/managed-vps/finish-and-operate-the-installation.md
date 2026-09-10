---
title: Finish and operate the managed installation
description: Claim the first Owner, move to the final domain, configure company login safely and maintain a managed CapacityLens installation.
---

# Finish and operate the managed installation

This page completes the installation and gives you a repeatable operating routine. You will claim
the first Owner, move from a temporary platform domain when necessary, and verify backups and
monitoring. Allow about fifteen minutes without a domain change; DNS and certificate issuance may
take longer.

## Prerequisites

- Complete [Deploy and upgrade safely](deploy-and-upgrade-safely.md).
- Have the one-time Owner setup token in a password manager.
- Have access to DNS and the platform's domain and certificate settings.
- Keep company login disabled until the final public origin is stable.

## 1. Claim the first Owner

Open the exact HTTPS origin in a private browser window. The empty installation asks for your name,
email, password and setup token.

Enter the one-time `SMALLSASS_ACCOUNT_SETUP_TOKEN` and create the first Owner. Then:

1. Sign out.
2. Sign in again with the new Owner credentials.
3. Confirm the Owner can open Settings.
4. Import the intended JSON file, if this installation starts from an export.
5. Confirm the imported people, projects and allocations belong to the expected company.

Do not enable demo seeding before an import. A new non-demo database starts empty.

After the Owner exists, remove `SMALLSASS_ACCOUNT_SETUP_TOKEN` from the environment and restart the
API. Keep the original value only in your private deployment record if your recovery policy
requires it; it cannot be used to create a second first Owner.

## 2. Add the final domain

Skip this step if the installation already uses its final domain.

Add the final domain to the managed site, then create the DNS record the platform requests. Wait
until public DNS resolves to this server before requesting the certificate.

Issue and activate a TLS certificate for the final domain. Verify the new origin in a browser before
changing CapacityLens.

Keep the temporary platform domain enabled until the final-domain verification below succeeds.

## 3. Change the exact public origin

Change this environment value to the final origin:

```dotenv
SMALLSASS_ACCOUNT_PUBLIC_URL=https://capacity.example.com
```

Use only the origin: scheme and hostname, with no path or trailing slash.

Change the platform health-check URL at the same time:

```text
https://capacity.example.com/api/health
```

Deploy manually so the runtime setting changes and health runs against the new origin.

Existing browser sessions are tied to the old secure origin. Expect to sign in again on the final
domain.

## 4. Verify and retire the temporary domain

Run:

```bash
curl -fsS https://capacity.example.com/api/health
```

Then sign in through the final domain and confirm one safe read and write. Inspect the response
headers and certificate in the browser.

Only after those checks pass should you disable the temporary platform domain. If you keep it as a
redirect, make it redirect to the final origin rather than serving a second usable copy of the app.

## 5. Add company login when required

Password sign-in and company login are configured independently for each CapacityLens installation.
One installation enabling company login does not change another installation on the same server.

Complete [Set up your company login](../../company-login/set-up-company-login.md) only after the
final public origin is stable. Register this exact redirect URI with the company login provider:

```text
https://capacity.example.com/api/auth/oauth2/callback/sso
```

The origin must match `SMALLSASS_ACCOUNT_PUBLIC_URL` character for character. Provider ids and
issuers become linked to stored identities after first use, so read the complete company-login
cutover guide before changing them.

Company login does not make the two installations share sessions, identities, queues, secrets or
databases. They remain separate processes on separate loopback ports.

## 6. Configure routine checks

At minimum:

- **Continuously:** poll the public `/api/health` endpoint.
- **Weekly:** review deep health, Supervisor restarts, disk space, audit size and backup freshness.
- **Monthly:** copy a snapshot to a temporary restore location and complete a restore test.
- **Before every release:** take a fresh snapshot, keep an off-server copy and record the rollback
  release.
- **After every release:** sign in, read data, make one safe write and check process logs.
- **After any domain or sign-in change:** test sign-in and session revocation in a private browser
  session.

Read [Monitoring and health checks](../monitoring.md) for every health field and alert condition.

## 7. Watch shared-server resources

CapacityLens is a small Node API and static web app, but each installation has its own Node process.
On a shared server, watch:

- available memory and swap activity;
- CPU during builds and password sign-in;
- free disk space and inode use;
- backup count and audit-log rotation;
- Supervisor restart loops; and
- nginx upstream errors.

Deploy shared-server installations one at a time. Dependency installation and frontend builds can
use much more CPU and memory than normal application traffic.

If one installation can exhaust resources needed by another, move it to a separate server. Site
users isolate files and permissions, not CPU, memory or the operating-system kernel.

## 8. Keep an operations record

For each installation, privately record:

- final and temporary domains;
- site user and site path;
- API loopback port;
- Supervisor group;
- source project, branch, release tag and commit;
- database, audit and backup paths;
- latest successful backup and restore test;
- company-login provider and redirect URI, when enabled; and
- the operator responsible for releases.

Do not record secret values in this document. Store them in a password manager or the platform's
secret store.

## Verify the result

The installation is complete when:

- the first Owner can sign in through the final HTTPS origin;
- imported data appears correctly and demo data is absent;
- the setup token has been removed from the runtime environment;
- the public deep-health check is operational;
- scheduled backups are fresh and an off-server copy exists;
- the manual deployment and rollback paths are recorded and tested;
- automatic deployment remains disabled; and
- each installation on the server has a unique user, port, paths, secrets and domain.

## What's next

- Read [Monitoring and health checks](../monitoring.md) for the regular operating routine.
- Keep [When something goes wrong](../incidents.md) available to the person on call.
