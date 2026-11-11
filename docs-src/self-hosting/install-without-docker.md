---
title: Install without Docker
description: Install the native CapacityLens archive on a Linux host with one command, or by hand with systemd and an HTTPS proxy.
prev:
  text: Install CapacityLens
  link: /self-hosting/install
next:
  text: Configuration
  link: /self-hosting/configuration
---

# Install without Docker

The native release archive runs on a Linux host with systemd and Node 24.19.0 or later within the
24.x line, behind an HTTPS proxy on the same machine. Whoever manages hosting installs it and
remains responsible for backups, upgrades and service health. Replace `X.Y.Z`, hostnames and
addresses with your own.

## Install with one command

Before you start, install Node 24 system-wide, point your domain name's DNS at the host and open
ports 80 and 443. Install [Caddy](https://caddyserver.com/docs/install) too, unless the host
already runs another HTTPS proxy. The archive contains a native SQLite addon and must match the
host operating system and architecture.

Download the archive and its checksum from the same GitHub release, verify and unpack it into
`/opt/capacitylens`, then run its install command with your domain name and the Owner's email
address:

```bash
sha256sum -c capacitylens-X.Y.Z.tar.gz.sha256
sudo install -d -m 0755 /opt/capacitylens
sudo tar -xzf capacitylens-X.Y.Z.tar.gz -C /opt/capacitylens
sudo sh /opt/capacitylens/capacitylens-X.Y.Z/install.sh capacity.example.com owner@example.com
```

The command runs the steps under [Install by hand](#install-by-hand):

- creates the `capacitylens` service user and `/var/lib/capacitylens` if they are missing
- writes `/etc/capacitylens.env`, readable by root only, with your address and a generated
  `APP_KEY` and `CAPACITYLENS_SECRET`; an existing file is kept unchanged
- points `/opt/capacitylens/current` at the release, runs the database upgrade, then installs and
  starts the systemd unit
- when Caddy is installed, writes `/etc/caddy/capacitylens.caddy`, imports it from
  `/etc/caddy/Caddyfile`, validates the result and reloads Caddy; otherwise it prints the address
  to point your proxy at
- prints the one-time setup link for the Owner

Verified backups run when the service starts and every 24 hours; see
[Backups and restore](/self-hosting/backups-and-restore). Mail is left unset: add the
`CAPACITYLENS_MAIL_*` settings with `sudoedit /etc/capacitylens.env` and restart the service before
inviting anyone else ([step 3](#_3-configure-the-installation) says what works without them). Open
the setup link and continue at [step 5](#_5-open). Until the Owner has signed up, running the same
command again finishes an interrupted install and prints a fresh link. Running a newer release's
command without arguments upgrades; see [Upgrades](/self-hosting/upgrades).

## Install by hand

Follow these five steps when the command does not suit the host.

### 1. Create the service and data directories

Keep writable state outside the release folder so a version change cannot remove it.

```bash
sudo useradd --system --home /var/lib/capacitylens --shell /usr/sbin/nologin capacitylens
sudo install -d -m 0755 /opt/capacitylens
sudo install -d -o capacitylens -g capacitylens -m 0700 /var/lib/capacitylens /var/lib/capacitylens/backups
```

Install Node 24.19.0 or a later 24.x release on the host and verify it with `node --version`. The
archive contains a native SQLite addon and must match the host operating system and architecture.

### 2. Download and unpack a release

Download the archive and its checksum from the same GitHub release. Verify it before extracting:

```bash
sha256sum -c capacitylens-X.Y.Z.tar.gz.sha256
sudo tar -xzf capacitylens-X.Y.Z.tar.gz -C /opt/capacitylens
sudo ln -sfn /opt/capacitylens/capacitylens-X.Y.Z /opt/capacitylens/current
```

The archive has `backend/` plus the example environment file and proxy/service templates.

### 3. Configure the installation

Create a private environment file outside the release and edit it for your host:

```bash
sudo install -o root -g root -m 0600 \
  /opt/capacitylens/current/capacitylens.env.example /etc/capacitylens.env
```

Generate an Adonis application key from the backend directory and copy the printed value into
`APP_KEY`:

```bash
cd /opt/capacitylens/current/backend
sudo -u capacitylens node ace.js generate:key --show
```

Set matching public HTTPS origins in `APP_URL` and `CAPACITYLENS_PUBLIC_URL`. Set `CAPACITYLENS_DB`
to `/var/lib/capacitylens/capacitylens.db`, `CAPACITYLENS_BACKUP_DIR` to its backups directory,
and generate a random value of at least 32 characters for `CAPACITYLENS_SECRET`. Keep open access
disabled.

Mail is optional for the first Owner: the bootstrap link is printed on the server and company
creation needs no email. Without the `CAPACITYLENS_MAIL_*` settings, invitations and address
confirmation are refused with a visible message asking for mail to be configured, the sign-in screen
offers no password reset, and Owner password recovery uses the stopped-server
[`owner:reset-password` command](/self-hosting/backups-and-restore#recover-a-sole-owner-s-local-password).
Fill in the mail settings before inviting anyone else. See
[Configuration](/self-hosting/configuration) for sign-in, mail, proxy and optional settings.

### 4. Upgrade the database and start the service

Run the upgrade as the service user with the same environment file. It initializes a fresh database;
for an existing database, it writes and verifies a pre-upgrade snapshot before running pending
migrations.

```bash
sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
  -p WorkingDirectory=/opt/capacitylens/current/backend \
  -p EnvironmentFile=/etc/capacitylens.env \
  -p Environment=NODE_ENV=production \
  /usr/bin/env node ace.js app:upgrade
```

Install the service unit and start it:

```bash
sudo cp /opt/capacitylens/current/capacitylens.service /etc/systemd/system/capacitylens.service
sudo systemctl daemon-reload
sudo systemctl enable --now capacitylens
```

The supplied unit runs one backend process as `capacitylens` and serves both the web app and API.
Put the supplied Caddy or nginx configuration at the network edge, adjusting the hostname and
certificate details. Do not expose the loopback application port publicly.

### 5. Open

Check `https://capacity.example.com/health/ready`. The install command has already printed the
one-time setup link; by hand, print it for the Owner's email address:

```bash
sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
  -p WorkingDirectory=/opt/capacitylens/current/backend \
  -p EnvironmentFile=/etc/capacitylens.env \
  -p Environment=NODE_ENV=production \
  /usr/bin/env node ace.js account-kit:admission:bootstrap owner@example.com --role=viewer
```

Open the printed link, enter a name and password and select **Accept invitation**. On **Set up your
company**, enter **Company name** and select **Create company**. Schedule opens with that identity as
Owner. Send the link privately if someone else will become Owner.

The company starts with Monday, Monday–Friday working days, day-based scheduling and the Internal
client, without a sample schedule. The server blocks additional open signup until the first company
exists, even when open signup is enabled in configuration.

Browser setup requires exactly one existing sign-in identity and no company or membership. If
multiple identities were created before the company, browser setup refuses rather than choosing
an Owner. Resolving that uncommon state currently needs the hosting operator's stopped-server
`company:initialize` initializer. This is a limitation, not an extra installation step. A second company is never created.

## Restore planning from a beta JSON export

On the source installation, sign in as its Owner and use **Settings → Data and support → Import
and export → Export JSON**. Keep the downloaded full `capacitylens-beta` version `1` document
unchanged. A redacted file or an older alpha export cannot restore this installation.

After completing the fresh Owner and company setup above, open **Import JSON** in the same section
on the destination. Select the file, choose **Continue**, review the replacement and select
**Replace data**. Confirm with the destination Owner's password. The source company's scheduling
records, relationships, name and supported settings replace the new company's initial data.
Scheduling IDs stay unchanged; the destination company keeps its own ID and sign-in records.

Check the imported people, catalogue, schedule and company settings. Add or edit an allocation,
then reload to check persistence. Invite other members again and link them to imported people as
needed: JSON transfers do not include identities, passwords, memberships or sessions. Keep the
source installation and export until you have verified the destination.

Continue with [TLS and networking](/self-hosting/tls-and-networking),
[Monitoring](/self-hosting/monitoring), and [Verify and hand over](/self-hosting/verify-and-hand-over).
