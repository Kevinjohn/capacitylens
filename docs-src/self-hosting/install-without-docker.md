---
title: Install without Docker
description: Install the native CapacityLens archive on a Linux host with systemd and an external HTTPS proxy.
prev:
  text: Install CapacityLens
  link: /self-hosting/install
next:
  text: Configuration
  link: /self-hosting/configuration
---

# Install without Docker

These steps use the native release archive, Node 24 in the supported 24.x line, systemd and a
reverse proxy on the same machine that terminates public TLS. Whoever manages hosting follows
these five steps and remains responsible for backups, upgrades and service health. Replace `X.Y.Z`, hostnames and paths with your own.

## 1. Create the service and data directories

Keep writable state outside the release folder so a version change cannot remove it.

```bash
sudo useradd --system --home /var/lib/capacitylens --shell /usr/sbin/nologin capacitylens
sudo install -d -m 0755 /opt/capacitylens
sudo install -d -o capacitylens -g capacitylens -m 0700 /var/lib/capacitylens /var/lib/capacitylens/backups
```

Install Node 24 on the host and verify `node --version` reports a supported 24.x release. The
archive contains a native SQLite addon and must match the host operating system and architecture.

## 2. Download and unpack a release

Download the archive and its checksum from the same GitHub release. Verify it before extracting:

```bash
sha256sum -c capacitylens-X.Y.Z.tar.gz.sha256
sudo tar -xzf capacitylens-X.Y.Z.tar.gz -C /opt/capacitylens
sudo ln -sfn /opt/capacitylens/capacitylens-X.Y.Z /opt/capacitylens/current
```

The archive has `backend/` plus the example environment file and proxy/service templates.

## 3. Configure the installation

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
and generate independent random values of at least 32 characters for `CAPACITYLENS_SECRET` and
`CAPACITYLENS_SETUP_TOKEN`. Keep open access disabled. See [Configuration](/self-hosting/configuration)
for authentication, mail, proxy and optional settings.

## 4. Upgrade the database and start the service

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

## 5. Open

Check `https://capacity.example.com/health/ready`, then open the site. Create the first sign-in with
`CAPACITYLENS_SETUP_TOKEN`, or use the configured Google identity approved for first sign-in. On
**Set up your company**, enter **Company name** and select **Create company**. Schedule opens with
that identity as Owner. There is no server stop, company command or restart during this browser step.
Send the address and setup token separately if someone else will become Owner.

The company starts with Monday, Monday–Friday working days, day-based scheduling and the Internal
client, without a sample schedule. The server blocks additional open signup until the first company
exists, even when open signup is enabled in configuration.
Remove the first-run token from the private environment at the next routine configuration change;
the server refuses its reuse once an identity exists.

Browser setup requires exactly one existing sign-in identity and no company or membership. If
multiple identities were created before the company, browser setup refuses rather than choosing
an Owner. Resolving that uncommon state currently needs the hosting operator's stopped-server
`company:initialize` initializer. This is a limitation, not an extra installation step. A second company is never created.

Continue with [TLS and networking](/self-hosting/tls-and-networking),
[Monitoring](/self-hosting/monitoring), and [Verify and hand over](/self-hosting/verify-and-hand-over).
