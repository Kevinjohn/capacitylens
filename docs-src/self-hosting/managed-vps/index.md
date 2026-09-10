---
title: Deploy on a managed VPS platform
description: Follow a complete production deployment path for Forge, Ploi, RunCloud and similar platforms that manage nginx and background processes for you.
---

# Deploy on a managed VPS platform

This guide takes you from an empty site on a managed Linux server to a production
CapacityLens installation with manual releases, persistent data, backups and health checks.
It is for platforms such as Laravel Forge, Ploi and RunCloud that manage nginx and a process
supervisor while your application runs directly on the host. Allow about an hour when the
server, source-control connection and domain are ready.

Laravel Forge is the worked example. Other platforms use different labels, but the same
parts are required.

## What you will build

One CapacityLens installation consists of:

- static web files from `dist/`, served by the platform's nginx site;
- one Node API process from `server/dist/index.mjs`, listening only on a loopback port;
- one SQLite database, audit log and backup directory outside every release directory;
- one exact public origin, with nginx sending `/api/` to the API process; and
- one manually promoted source branch, so a push to the public project cannot deploy itself.

The web app and API share a public origin. Do not create a separate public API domain.

```text
Browser
  |
  | HTTPS
  v
Platform nginx
  |-- /api/* ----> 127.0.0.1:8788 ----> CapacityLens API
  |
  `-- /* --------> current/dist --------> CapacityLens web app

CapacityLens API
  |-- database --> /home/<site-user>/data/capacitylens.db
  |-- audit -----> /home/<site-user>/data/capacitylens-audit.jsonl
  `-- backups ---> /home/<site-user>/backups/
```

::: warning One API process per database
Exactly one API process may use a CapacityLens database. A managed platform's
"zero-downtime" deployment must not overlap the old and new API processes. The deployment
guide deliberately includes a short stop while it switches releases.
:::

## Prerequisites

- A Linux server managed by a platform that can configure nginx and a supervised background
  process.
- Node 24 or newer, Corepack and git on that server.
- A source-control account the platform can read.
- A domain or a temporary HTTPS domain supplied by the platform.
- A unique loopback port for this installation.
- Access to create DNS records and TLS certificates before the final domain cutover.

For a small installation, start with at least 2 GB of RAM. A single shared vCPU is reasonable
for a lightly used instance. Several installations can share a server when each has a separate
site user, loopback port, database, backup directory, secrets and domain. Separate servers give
stronger resource and operational isolation.

## Follow the guide

Complete these pages in order:

1. [Choose the release source](choose-the-release-source.md) — pin releases and prevent
   automatic deployment from the public project.
2. [Create and build the site](create-and-build-the-site.md) — map CapacityLens onto the
   platform's site and release-directory settings.
3. [Configure the API and nginx](configure-the-api-and-nginx.md) — add secrets, persistent
   paths, the background process and the same-origin proxy.
4. [Deploy and upgrade safely](deploy-and-upgrade-safely.md) — stop, activate and start one
   API version at a time, with backups and rollback points.
5. [Finish and operate the installation](finish-and-operate-the-installation.md) — claim the
   Owner, move to the final domain, add company login and monitor the instance.

Do not skip the verification section at the end of each page. Each result is the prerequisite
for the next page.

## Translate the platform labels

| CapacityLens requirement | Laravel Forge label | Common equivalent |
| --- | --- | --- |
| Static site plus Node API | **Other** site | Custom application |
| Repository checkout | Repository and branch | Git source |
| Stable active-release path | `current` symlink | Current release |
| Static web root | Web directory `/dist` | Public directory |
| Long-running API | Background process | Supervisor service or worker |
| Runtime settings | Environment | Environment variables or secrets |
| Manual release | **Deploy** with push-to-deploy off | Manual deployment |
| Public readiness probe | Deployment health check | Post-deploy or uptime check |

Do not select a PHP framework template. CapacityLens is a Node application even when the
platform was originally designed around PHP hosting.

## Write down your values first

Replace every placeholder in the later pages from this private worksheet. Do not store secret
values in the worksheet.

| Value | Example | Your value |
| --- | --- | --- |
| Source project | `YOUR-ACCOUNT/capacitylens-hosted` | |
| Production branch | `production-01` | |
| Release tag and commit | `vX.Y.Z` and its full commit | |
| Site user | `capacity-example` | |
| Site directory | `/home/capacity-example/capacity.example.com` | |
| Temporary origin | `https://capacity-example.on-forge.com` | |
| Final origin | `https://capacity.example.com` | |
| API loopback port | `8788` | |
| Supervisor group | `daemon-1234567` | |
| Database path | `/home/capacity-example/data/capacitylens.db` | |
| Backup path | `/home/capacity-example/backups` | |

Keep the session-signing secret, one-time setup token and any company-login credentials in the
platform's secret store or a password manager, not in this worksheet.

## What's next

Start with [Choose the release source](choose-the-release-source.md).
