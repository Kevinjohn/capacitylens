---
title: Install without Docker
description: Clone CapacityLens at a release tag, build it and run it under systemd behind an HTTPS proxy on a Linux host.
prev:
  text: Install CapacityLens
  link: /self-hosting/install
next:
  text: Configuration
  link: /self-hosting/configuration
---

# Install without Docker

CapacityLens installs from the repository: clone it at a release tag, install, build and run it
under a process manager behind an HTTPS proxy on the same machine. These steps use a Linux host
with systemd, Git, Node 24.19.0 or later within the 24.x line, and pnpm at the version named in the
`packageManager` field of `package.json` (`corepack enable` provides it). Install `python3`, `make`
and `g++` as well (on Debian or Ubuntu, `sudo apt-get install python3 make g++`): the SQLite driver,
`better-sqlite3`, compiles with them when no prebuilt binary matches the host. Whoever manages hosting
installs it and remains responsible for backups, upgrades and service health. Replace `X.Y.Z`,
hostnames and addresses with your own.

Before you start, point your domain name's DNS at the host and open ports 80 and 443. Install an
HTTPS proxy such as [Caddy](https://caddyserver.com/docs/install) on the same machine.

## Install

### 1. Create the service and data directories

Keep writable state outside the clone so a version change cannot remove it.

```bash
sudo useradd --system --home /var/lib/capacitylens --shell /usr/sbin/nologin capacitylens
sudo install -d -o capacitylens -g capacitylens -m 0700 /var/lib/capacitylens /var/lib/capacitylens/backups
```

Install Node 24.19.0 or a later 24.x release on the host and verify it with `node --version`.

### 2. Clone, install and build

Clone the repository at the release tag, install the locked dependencies and build. The build starts
the production configuration, which needs an HTTPS origin and an application key; these values are
used only while building and are not the runtime settings.

```bash
sudo git clone --branch vX.Y.Z --depth 1 https://github.com/Kevinjohn/capacitylens.git /opt/capacitylens
cd /opt/capacitylens
sudo pnpm install --frozen-lockfile
sudo env NODE_ENV=production HOST=127.0.0.1 PORT=0 LOG_LEVEL=error \
  APP_KEY=capacitylens-build-key-0123456789abcdef \
  APP_URL=https://127.0.0.1 CAPACITYLENS_PUBLIC_URL=https://127.0.0.1 pnpm run build
```

The server runs from `/opt/capacitylens/apps/backend/build`, which serves the web app and the API.
The service user needs read access to `/opt/capacitylens`.

### 3. Configure the installation

Create a private environment file outside the clone and edit it for your host:

```bash
sudo install -o root -g root -m 0600 \
  /opt/capacitylens/packaging/release/capacitylens.env.example /etc/capacitylens.env
```

Generate an AdonisJS application key from the build directory and copy the printed value into
`APP_KEY`:

```bash
cd /opt/capacitylens/apps/backend/build
sudo -u capacitylens node ace.js generate:key --show
```

Set matching public HTTPS origins in `APP_URL` and `CAPACITYLENS_PUBLIC_URL`. Set `CAPACITYLENS_DB`
to `/var/lib/capacitylens/capacitylens.db` and `CAPACITYLENS_BACKUP_DIR` to its backups directory.
Keep open access disabled.

Mail is optional for the first Owner: the bootstrap link is printed on the server and company
creation needs no email. Without the `CAPACITYLENS_MAIL_*` settings, invitations and address
confirmation are refused with a visible message asking for mail to be configured, the sign-in screen
offers no password reset, and Owner password recovery uses the stopped-server
[`owner:reset-password` command](/self-hosting/backups-and-restore#recover-a-sole-owner-s-local-password).
Fill in the mail settings before inviting anyone else. See
[Configuration](/self-hosting/configuration) for sign-in, mail, proxy and optional settings.

### 4. Upgrade the database and start the service

Run the upgrade as the service user with the same environment file. It initialises a fresh database;
for an existing database, it writes and verifies a pre-upgrade backup before running pending
migrations.

```bash
sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
  -p WorkingDirectory=/opt/capacitylens/apps/backend/build \
  -p EnvironmentFile=/etc/capacitylens.env \
  -p Environment=NODE_ENV=production \
  /usr/bin/env node ace.js app:upgrade
```

Install the service unit and start it:

```bash
sudo cp /opt/capacitylens/packaging/release/capacitylens.service /etc/systemd/system/capacitylens.service
sudo systemctl daemon-reload
sudo systemctl enable --now capacitylens
```

The supplied unit runs one backend process as `capacitylens` and serves both the web app and API.
Put the Caddy or nginx configuration from `packaging/release/` at the network edge, adjusting the
hostname and certificate details; [TLS and networking](/self-hosting/tls-and-networking) has the
details. Do not expose the loopback application port publicly.

### 5. Open

Check `https://capacity.example.com/health/ready`: it answers HTTP 200 with `"isHealthy":true`
when the service is ready, and HTTP 503 when the database checks fail
([Monitoring](/self-hosting/monitoring)). Print the one-time setup link for the Owner's
email address:

```bash
sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
  -p WorkingDirectory=/opt/capacitylens/apps/backend/build \
  -p EnvironmentFile=/etc/capacitylens.env \
  -p Environment=NODE_ENV=production \
  /usr/bin/env node ace.js account-kit:admission:bootstrap owner@example.com --role=viewer
```

If you are the Owner, open the printed link in your browser. Otherwise, send it privately to the
person who will be Owner; they continue from [Access your company](/owner/). The link opens
**Accept invite**: enter a **Name** and **Password** and select **Accept invitation**. On **Set up
your company**, enter **Company name** and select **Create company**. Schedule opens with that
identity as Owner.

The company starts with Monday, Monday–Friday working days, day-based scheduling and the Internal
client, without an example schedule. The server blocks additional open sign-up until the first company
exists, even when open sign-up is enabled in configuration.

Browser setup requires exactly one existing sign-in identity and no company or membership. If
multiple identities were created before the company, browser setup refuses rather than choosing
an Owner. Resolving that uncommon state currently needs the hosting operator's stopped-server
`company:initialize` initialiser. This is a limitation, not an extra installation step. A second company is never created.

## Restore planning from a beta JSON export

On the source installation, sign in as its Owner and use **Settings → Data and support → Import
and export → Export JSON**. Keep the downloaded full `capacitylens-beta` version `2` document
unchanged. A redacted file cannot restore this installation.

After completing the fresh Owner and company setup above, open **Import JSON** in the same section
on the destination. Select the file, choose **Continue**, review the replacement and select
**Replace data**. Confirm with the destination Owner's password. The source company's scheduling
records, relationships, name and supported settings replace the new company's initial data.
Scheduling IDs stay unchanged; the destination company keeps its own ID and sign-in records.

Check the imported people, catalogue, schedule and company settings. Add or edit an allocation,
then reload to check persistence. Invite other members again and link them to imported people as
needed: JSON exports do not include identities, passwords, memberships or sessions. Keep the
source installation and export until you have verified the destination.

Continue with [TLS and networking](/self-hosting/tls-and-networking),
[Monitoring](/self-hosting/monitoring), and [Verify and hand over](/self-hosting/verify-and-hand-over).
