---
title: Install without Docker
description: The five install steps in full on a Linux host, from the release archive, with systemd and Caddy, and no Docker or build tools.
prev:
  text: Install CapacityLens
  link: /self-hosting/install
next:
  text: Configuration
  link: /self-hosting/configuration
---

# Install without Docker

The [five install steps](/self-hosting/install) in full, on a Linux host you manage, from the
release archive.

You need a Linux host with systemd, a hostname pointing at it, and
[Caddy](https://caddyserver.com/docs/install) or nginx for HTTPS. Install Node 24.19.0 or newer
within 24.x system-wide, from NodeSource or the official tarball into `/usr/local`. If you use
nvm, copy its binary once: `sudo install -D -m 0755 "$(command -v node)" /usr/local/bin/node`.
[Install CapacityLens](/self-hosting/install#you-need) lists the tested platforms and the
experimental Node 26 line.

The commands name release 0.73.0-alpha.1, the first with an archive. For a newer release, use its
version; the archive's `VERSION` file names the one you have.

## 1. Download

Download and unpack the archive, then link `current` to the release:

```bash
curl -LO https://github.com/Kevinjohn/capacitylens/releases/download/v0.73.0-alpha.1/capacitylens-0.73.0-alpha.1.tar.gz
sudo mkdir -p /opt/capacitylens && sudo tar -xzf capacitylens-0.73.0-alpha.1.tar.gz -C /opt/capacitylens && sudo ln -sfn /opt/capacitylens/capacitylens-0.73.0-alpha.1 /opt/capacitylens/current
```

To check the archive against its checksum before you unpack it:

```bash
curl -LO https://github.com/Kevinjohn/capacitylens/releases/download/v0.73.0-alpha.1/capacitylens-0.73.0-alpha.1.tar.gz.sha256
```

```bash
sha256sum -c capacitylens-0.73.0-alpha.1.tar.gz.sha256
```

## 2. Pick a folder for the data

Create the service user and its data folder. The database file appears there on first start:

```bash
sudo useradd --system --home /var/lib/capacitylens --shell /usr/sbin/nologin capacitylens
sudo install -d -o capacitylens -g capacitylens -m 0700 /var/lib/capacitylens
```

## 3. Configure

Write `/etc/capacitylens.env` with `init`, using the address people will open:

```bash
sudo node /opt/capacitylens/current/server/dist/index.mjs init --public-url https://capacity.example.com --db /var/lib/capacitylens/capacitylens.db --out /etc/capacitylens.env
```

It generates `CAPACITYLENS_SECRET` and `CAPACITYLENS_SETUP_TOKEN`, writes the file readable only
by root (systemd reads it as root), and refuses to overwrite an existing one, so a second run
cannot replace keys. [Configuration](/self-hosting/configuration) lists every other setting.

## 4. Start it

Install the systemd service, then put [HTTPS](#https) in front:

```bash
sudo cp /opt/capacitylens/current/capacitylens.service /etc/systemd/system/ && sudo systemctl enable --now capacitylens
```

Check it is healthy:

```bash
curl -fsS http://127.0.0.1:8787/api/health
```

Expect `"ok":true`, `"db":true`, `"audit":"ok"` and a `backup` whose `status` is `"ok"`. It reads
`"pending"` for a minute after the first start. Fix a `503`, a degraded field or a restart loop
before you hand over: follow the log with `journalctl -u capacitylens -f`.
[Monitoring and health checks](/self-hosting/monitoring) explains each field.

### HTTPS

Caddy obtains and renews the certificate itself. Add this block from the archive's
`Caddyfile.example` to `/etc/caddy/Caddyfile`, with your own hostname:

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

For nginx, get a certificate first with your distribution's ACME client, such as certbot. Then
copy the archive's complete site file, replace the hostname and certificate paths, and enable it:

```bash
sudo cp /opt/capacitylens/current/capacitylens.nginx.conf /etc/nginx/sites-available/capacitylens
```

```bash
sudo ln -s /etc/nginx/sites-available/capacitylens /etc/nginx/sites-enabled/
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Check through the proxy too:

```bash
curl -fsS https://capacity.example.com/api/health
```

[TLS and networking](/self-hosting/tls-and-networking) covers the proxy requirements.

## 5. Open the address

Send the intended Owner the address and the `CAPACITYLENS_SETUP_TOKEN` value from
`/etc/capacitylens.env` through a private channel. They open the address and enter it once, on
the first-owner screen. Do not create the Owner for them.

After the Owner has signed in, delete the `CAPACITYLENS_SETUP_TOKEN` line from
`/etc/capacitylens.env` and restart the service:

```bash
sudo systemctl restart capacitylens
```

First-owner setup is open only while the database holds no users and a token is set. Erasing the
sole identity reopens it, so set a new token only to create a new first Owner.
[Verify and hand over](/self-hosting/verify-and-hand-over) finishes the job.

## Customise the service

`capacitylens.service` assumes `/opt/capacitylens/current`, the `capacitylens` user and `node` on
the system path. To change them, edit the copy in `/etc/systemd/system/` and run
`sudo systemctl daemon-reload`.

- Keep these lines. They set production mode on the process and give requests time to drain
  before it exits:

  ```ini
  [Service]
  User=capacitylens
  WorkingDirectory=/opt/capacitylens/current/server
  EnvironmentFile=/etc/capacitylens.env
  Environment=NODE_ENV=production
  TimeoutStopSec=30
  ```

Next: [Backups and restore](/self-hosting/backups-and-restore) to protect the database, and
[Upgrades](/self-hosting/upgrades) for newer releases.
