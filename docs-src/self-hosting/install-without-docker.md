---
title: Install without Docker
description: Install CapacityLens on a Linux host from the release archive in five steps, with systemd and Caddy, and no Docker or build tools.
prev:
  text: Install CapacityLens
  link: /getting-started/install
next:
  text: Configure the service
  link: /installation/configure-the-service
---

# Install without Docker

This installs CapacityLens on a Linux host you manage yourself, from the release archive. It
takes the five steps from [Install CapacityLens](/getting-started/install), with a command or
two for each of the first four. Each `sudo` line does what a managed host does when you create a site: a user, a
folder, a service and a proxy. The target is ten minutes on a host that already has Node 24
and a hostname pointing at it.

## Prerequisites

- A Linux host with systemd. The archive is tested on Ubuntu x86-64; other Linux distributions
  and macOS are expected to work but are not tested.
- Node 24 on the system path. Install it system-wide first, from NodeSource or the official
  tarball into `/usr/local`. If you use nvm, copy its binary once:
  `sudo install -D -m 0755 "$(command -v node)" /usr/local/bin/node`.
- A hostname that points at the host.
- [Caddy](https://caddyserver.com/docs/install) or nginx, for HTTPS.
- Read [Before you start](/self-hosting/) if you haven't already.

The commands name release 0.73.0-alpha.1, the first to carry the archive. For a newer release,
use its version instead; the `VERSION` file in the archive names the one you have.

## The five steps

1. Download and unpack, then link `current` to the release:

   ```bash
   curl -LO https://github.com/Kevinjohn/capacitylens/releases/download/v0.73.0-alpha.1/capacitylens-0.73.0-alpha.1.tar.gz
   sudo mkdir -p /opt/capacitylens && sudo tar -xzf capacitylens-0.73.0-alpha.1.tar.gz -C /opt/capacitylens && sudo ln -sfn /opt/capacitylens/capacitylens-0.73.0-alpha.1 /opt/capacitylens/current
   ```

   To check the download first, see [Verify the download](#verify-the-download).

2. Create a user and a folder for its data. The database file appears there on first start:

   ```bash
   sudo useradd --system --home /var/lib/capacitylens --shell /usr/sbin/nologin capacitylens
   sudo install -d -o capacitylens -g capacitylens -m 0700 /var/lib/capacitylens
   ```

3. Configure. Write `/etc/capacitylens.env` with `init`, using the address people will open:

   ```bash
   sudo node /opt/capacitylens/current/server/dist/index.mjs init --public-url https://capacity.example.com --db /var/lib/capacitylens/capacitylens.db --out /etc/capacitylens.env
   ```

   It generates `CAPACITYLENS_SECRET` and `CAPACITYLENS_SETUP_TOKEN`, writes the file readable only
   by root, and refuses to overwrite an existing one, so running it again cannot replace keys. It
   then prints the setup token: you enter it once, to create the Owner. Everything else has a
   default. [Configure the service](/installation/configure-the-service) lists every other setting.

   systemd reads the file as root before it starts the service, so the service user needs no
   access to it.

4. Start it as a systemd service:

   ```bash
   sudo cp /opt/capacitylens/current/capacitylens.service /etc/systemd/system/ && sudo systemctl enable --now capacitylens
   ```

   Then put HTTPS in front of it, as described in [HTTPS](#https).

5. Open the address and create your company. The page asks for the setup token: it is the
   `CAPACITYLENS_SETUP_TOKEN` line in `/etc/capacitylens.env`.

## Check that it is healthy

Check the server on the host:

```bash
curl -fsS http://127.0.0.1:8787/api/health
```

Expect `"ok":true`, `"db":true`, `"audit":"ok"` and a `backup` whose `status` is `"ok"`. It reads
`"pending"` for a moment after the first start; check again after a minute. A `503`, a degraded
field or a restart loop needs fixing before you hand over: follow the log with
`journalctl -u capacitylens -f`. [Monitoring and health checks](/self-hosting/monitoring) explains
each field.

## HTTPS

Put a TLS-terminating reverse proxy in front of the server. Caddy is the shortest route: it
obtains and renews the certificate itself.

Add this block from `Caddyfile.example` in the archive to `/etc/caddy/Caddyfile`, with your own
hostname:

```text
capacity.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8787
}
```

Then reload Caddy:

```bash
sudo systemctl reload caddy
```

nginx is the alternative. The archive's `capacitylens.nginx.conf` is a complete site file:
it terminates TLS, serves the web app and proxies `/api/` to the server, and keeps invitation,
sign-in and password-reset links out of the access log. Get a certificate first with your
distribution's ACME client, for example certbot. Then copy the file, replace the hostname and the
certificate paths in it, and enable it:

```bash
sudo cp /opt/capacitylens/current/capacitylens.nginx.conf /etc/nginx/sites-available/capacitylens
```

```bash
sudo ln -s /etc/nginx/sites-available/capacitylens /etc/nginx/sites-enabled/
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The server sends HSTS itself when the address in `CAPACITYLENS_PUBLIC_URL` is `https`.
[TLS and networking](/self-hosting/tls-and-networking) covers the proxy requirements.

Open the public address and check it through the proxy too:

```bash
curl -fsS https://capacity.example.com/api/health
```

## Hand over the setup token

Give the intended Owner the address and the `CAPACITYLENS_SETUP_TOKEN` value through a
private channel. They enter it once, on the first-owner screen. Do not create the Owner for them.

After the Owner has signed in, delete the `CAPACITYLENS_SETUP_TOKEN` line from
`/etc/capacitylens.env` and restart the service:

```bash
sudo systemctl restart capacitylens
```

First-owner setup is open only while the database holds no users and a token is set. Erasing the
sole identity later reopens it, so set a new token only when you mean to create a new first
Owner. [Verify and hand over](/installation/verify-and-hand-over) finishes the job.

## Customise the service

`capacitylens.service` assumes `/opt/capacitylens/current`, the `capacitylens` user and `node` on
the system path. To change any of them, edit the copy in `/etc/systemd/system/` and run
`sudo systemctl daemon-reload`.

- Keep these lines. The service sets production mode on the process itself, and gives requests
  time to drain before it exits:

  ```ini
  [Service]
  User=capacitylens
  WorkingDirectory=/opt/capacitylens/current/server
  EnvironmentFile=/etc/capacitylens.env
  Environment=NODE_ENV=production
  TimeoutStopSec=30
  ```

## Optional

### Verify the download

Check the archive against its checksum before you unpack it:

```bash
curl -LO https://github.com/Kevinjohn/capacitylens/releases/download/v0.73.0-alpha.1/capacitylens-0.73.0-alpha.1.tar.gz.sha256
```

```bash
sha256sum -c capacitylens-0.73.0-alpha.1.tar.gz.sha256
```

## What's next

- [Upgrades](/self-hosting/upgrades) to install a newer release.
- [Secure the connection](/installation/secure-the-connection) for the proxy requirements before
  anyone outside your network reaches this host.
- [Backups and restore](/self-hosting/backups-and-restore) to protect the database this
  install just created.
