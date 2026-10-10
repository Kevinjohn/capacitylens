---
title: Finish and operate the managed installation
description: Verify the managed service, hand it to the first Owner, and establish its operating routine.
next:
  text: Configuration
  link: /self-hosting/configuration
---

# Finish and operate the managed installation

Move to the final domain if needed, hand the setup token to the first
[Owner](/reference/glossary), and set up the operating routine. About fifteen minutes without a
domain change; DNS and certificate issuance can take longer.

## Prerequisites

- Complete [Deploy and upgrade safely](/self-hosting/managed-vps/deploy-and-upgrade-safely).
- Have the one-time Owner setup token ready to transfer privately to the intended Owner.
- Have access to DNS and the platform's domain and certificate settings.
- Keep [company login](/reference/glossary) disabled until the final public origin is stable.

## 1. Add the final domain

Skip this if the installation already uses its final domain.

Add the final domain to the site and create the DNS record the platform requests. Once public DNS
resolves to this server, issue and activate the TLS certificate, and check the new origin in a
browser. Keep the temporary domain enabled until step 5.

## 2. Change the exact public origin

Change this environment value to the final origin:

```dotenv
CAPACITYLENS_PUBLIC_URL=https://capacity.example.com
```

Use only the scheme and hostname, with no path or trailing slash. Change the platform health-check
URL at the same time:

```text
https://capacity.example.com/api/health
```

Deploy manually so the setting takes effect and health runs against the new origin. Existing
sessions belong to the old origin, so everyone signs in again.

## 3. Verify the final public origin

```bash
curl -fsS https://capacity.example.com/api/health
```

Check the response headers and certificate in the browser, and resolve any certificate, proxy or
health error before handover.

## 4. Hand over to the first Owner

Send the intended Owner three things through a private channel:

- the final CapacityLens address;
- the one-time `CAPACITYLENS_SETUP_TOKEN`; and
- the [Set up your company](/owner/) guide.

The Owner creates their own credentials and company; don't enter the token or create the Owner
for them. Don't enable demo seeding on a production installation.

Once the Owner can sign in, remove `CAPACITYLENS_SETUP_TOKEN` from the environment, restart the
API and confirm health. Destroy the transferred copy unless your recovery policy needs a protected
record; it cannot create a second first Owner.

## 5. Verify sign-in and retire the temporary domain

Ask the Owner to sign in on the final domain and confirm one safe read and write. Then disable
the temporary domain, or make it redirect to the final origin rather than serve a second copy of
the app.

## 6. Add company login when required

Sign-in is configured per installation; enabling company login on one does not change another
on the same server.

Before changing sign-in settings, take a fresh snapshot and preserve a complete recovery bundle:
the stopped database with its `-wal`/`-shm` sidecars, the current and rotated audit logs, and an
off-server copy of the snapshot. A database file copied by itself is not a complete SSO recovery
point. For Docker Compose, run only the
[preservation step](/self-hosting/backups-and-restore#preserve-compose-files) against the actual
volumes, not the restore steps, then copy the bundle off-server.

Once the final origin is stable, complete
[Set up Google or Microsoft sign-in](/company-login/set-up-company-login) and register the exact
callback address. For Google:

```text
https://capacity.example.com/api/auth/callback/google
```

For Microsoft, use `https://capacity.example.com/api/auth/callback/microsoft`. The origin must
match `CAPACITYLENS_PUBLIC_URL` character for character. To require company sign-in, see
[Require company sign-in](/company-login/move-to-single-sign-on). Installations never share
sessions, identities, queues, secrets or databases: they are separate processes on separate
loopback ports.

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

[Monitoring and health checks](/self-hosting/monitoring) explains every health field and alert.

## 8. Watch shared-server resources

Each installation runs its own Node process. On a shared server, watch:

- available memory and swap activity;
- CPU during builds and password sign-in;
- free disk space and inode use;
- backup count and audit-log rotation;
- Supervisor restart loops; and
- nginx upstream errors.

Deploy installations one at a time: dependency installs and builds use far more CPU and memory
than normal traffic. When staging and production share a branch, finish staging's smoke test
before clicking **Deploy** on production; each deployment still activates its own checkout.

Site users isolate files and permissions, not CPU, memory or the kernel. If one installation can
exhaust resources another needs, move it to a separate server.

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

Keep secret values out of this record, in a password manager or the platform's secret store.

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

Keep [When something goes wrong](/self-hosting/incidents) to hand for whoever is on call.
[Configuration](/self-hosting/configuration) covers every other setting.
