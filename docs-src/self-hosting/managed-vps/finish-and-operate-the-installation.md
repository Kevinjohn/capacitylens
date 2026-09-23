---
title: Finish and operate the managed installation
description: Verify the managed service, hand it to the first Owner, and establish its operating routine.
next:
  text: Configure the service
  link: /installation/configure-the-service
---

# Finish and operate the managed installation

This page completes the technical installation and gives you a repeatable operating routine. You
will verify the service, hand the private setup route to the first [Owner](/reference/glossary),
move from a temporary platform domain when necessary, and verify backups and monitoring. Allow
about fifteen minutes without a domain change; DNS and certificate issuance may take longer.

## Prerequisites

- Complete [Deploy and upgrade safely](/self-hosting/managed-vps/deploy-and-upgrade-safely).
- Have the one-time Owner setup token ready to transfer privately to the intended Owner.
- Have access to DNS and the platform's domain and certificate settings.
- Keep [company login](/reference/glossary) disabled until the final public origin is stable.

## 1. Add the final domain

Skip this step if the installation already uses its final domain.

Add the final domain to the managed site, then create the DNS record the platform requests. Wait
until public DNS resolves to this server before requesting the certificate.

Issue and activate a TLS certificate for the final domain. Verify the new origin in a browser before
changing CapacityLens.

Keep the temporary platform domain enabled until the final-domain verification below succeeds.

## 2. Change the exact public origin

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

## 3. Verify the final public origin

Run:

```bash
curl -fsS https://capacity.example.com/api/health
```

Inspect the response headers and certificate in the browser. Resolve certificate, proxy or health
errors before handover.

## 4. Hand over to the first Owner

Send the intended Owner three things through a private channel:

- the final CapacityLens address;
- the one-time `SMALLSASS_ACCOUNT_SETUP_TOKEN`; and
- the [Owner setup guide](/owner/).

The Owner creates their own credentials and company. Do not enter the token or create the Owner on
their behalf. Do not enable demo seeding on this production installation.

After the Owner confirms they can sign in, remove `SMALLSASS_ACCOUNT_SETUP_TOKEN` from the
environment and restart the API. Confirm health again, then destroy the transferred copy unless
your recovery policy requires a protected record; it cannot create a second first Owner.

## 5. Verify sign-in and retire the temporary domain

Ask the Owner to sign in through the final domain and confirm one safe read and write.

Only after those checks pass should you disable the temporary platform domain. If you keep it as a
redirect, make it redirect to the final origin rather than serving a second usable copy of the app.

## 6. Add company login when required

Password sign-in and company login are configured independently for each CapacityLens installation.
One installation enabling company login does not change another installation on the same server.

Before changing sign-in settings, take a fresh snapshot and preserve a complete recovery
bundle: the stopped database with its `-wal`/`-shm` sidecars, the current and rotated audit
logs, and an off-server copy of the snapshot. For Docker Compose, run only the
[preservation step](/self-hosting/backups-and-restore#preserve-compose-files) against the actual
volumes, then copy the resulting bundle off-server. Do not continue to the restore steps. A
database file copied by itself is not a complete SSO recovery point.

Complete [Set up Google or Microsoft sign-in](/company-login/set-up-company-login) only
after the final public origin is stable. Register the provider's exact callback address.
For Google:

```text
https://capacity.example.com/api/auth/callback/google
```

For Microsoft, use `https://capacity.example.com/api/auth/callback/microsoft`.
The origin must match `SMALLSASS_ACCOUNT_PUBLIC_URL` character for character. Configure
the Google web client or Microsoft tenant-specific app as described in the setup guide.
If you want to require company sign-in, read [Require company sign-in](/company-login/move-to-single-sign-on).

Company login does not make the two installations share sessions, identities, queues, secrets or
databases. They remain separate processes on separate loopback ports.

## 7. Configure routine checks

At minimum:

- **Continuously:** poll the public `/api/health` endpoint.
- **Weekly:** review deep health, Supervisor restarts, disk space, audit size and backup freshness.
- **Monthly:** copy a snapshot to a temporary restore location and complete a restore test.
- **Before every release:** take a fresh snapshot, keep an off-server copy and record the rollback
  release.
- **After every release:** sign in, read data, make one safe write and check process logs.
- **After any domain or sign-in change:** test sign-in and session revocation in a private browser
  session.

Read [Monitoring and health checks](/self-hosting/monitoring) for every health field and alert condition.

## 8. Watch shared-server resources

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

When staging and production select the same project and branch, deploy staging first and finish its
smoke test before clicking **Deploy** on production. Do not run the two builds concurrently on a
small shared server. The sites remain independent: each manual deployment records and activates its
own checkout even though both read the same branch.

If one installation can exhaust resources needed by another, move it to a separate server. Site
users isolate files and permissions, not CPU, memory or the operating-system kernel.

## 9. Keep an operations record

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

- Return to [Configure the service](/installation/configure-the-service) for the
  installation track.
- Read [Monitoring and health checks](/self-hosting/monitoring) for the regular operating routine.
- Keep [When something goes wrong](/self-hosting/incidents) available to the person on call.
