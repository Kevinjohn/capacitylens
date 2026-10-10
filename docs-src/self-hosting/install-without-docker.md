---
title: Install without Docker
description: Install CapacityLens on a Linux host from the release archive in five steps, with systemd and Caddy, and no Docker or build tools.
prev:
  text: Install CapacityLens
  link: /self-hosting/install
next:
  text: Configuration
  link: /self-hosting/configuration
---

# Install without Docker

The [five install steps](/self-hosting/install) on a Linux host you manage yourself, from the
release archive. About ten minutes on a host that already has Node 24 and a hostname pointing at it.

## Prerequisites

- A Linux host with systemd. The archive is tested on Ubuntu x86-64; other Linux distributions
  and macOS are expected to work but are not tested.
- Node 24.19.0 or newer within 24.x on the system path, installed system-wide from NodeSource or
  the official tarball into `/usr/local`. If you use nvm, copy its binary once:
  `sudo install -D -m 0755 "$(command -v node)" /usr/local/bin/node`. Node 26.9.0 or newer within
  26.x is experimental; see [the compatibility policy](/reference/development#check-node-26-compatibility).
- A hostname that points at the host.
- [Caddy](https://caddyserver.com/docs/install) or nginx, for HTTPS.

The commands name release 0.73.0-alpha.1, the first with an archive. For a newer release, use its
version; the archive's `VERSION` file names the one you have.

## The five steps

1. Download and unpack, then link `current` to the release:

   ```bash
   curl -LO https://github.com/Kevinjohn/capacitylens/releases/download/v0.73.0-alpha.1/capacitylens-0.73.0-alpha.1.tar.gz
   sudo mkdir -p /opt/capacitylens && sudo tar -xzf capacitylens-0.73.0-alpha.1.tar.gz -C /opt/capacitylens && sudo ln -sfn /opt/capacitylens/capacitylens-0.73.0-alpha.1 /opt/capacitylens/current
   ```

   To check the download first, see [Verify the download](#verify-the-download).

2. Create a user and a data folder. The database file appears there on first start:

   ```bash
   sudo useradd --system --home /var/lib/capacitylens --shell /usr/sbin/nologin capacitylens
   sudo install -d -o capacitylens -g capacitylens -m 0700 /var/lib/capacitylens
   ```

3. Write `/etc/capacitylens.env` with `init`, using the address people will open:

   ```bash
   sudo node /opt/capacitylens/current/server/dist/index.mjs init --public-url https://capacity.example.com --db /var/lib/capacitylens/capacitylens.db --out /etc/capacitylens.env
   ```

   It generates `CAPACITYLENS_SECRET` and `CAPACITYLENS_SETUP_TOKEN`, writes the file readable only
   by root, and refuses to overwrite an existing one, so running it again cannot replace keys. It
   then prints the setup token, which is entered once to create the Owner. systemd reads the file
   as root, so the service user needs no access to it. [Configuration](/self-hosting/configuration)
   lists every other setting.

4. Start it as a systemd service, then put [HTTPS](#https) in front:

   ```bash
   sudo cp /opt/capacitylens/current/capacitylens.service /etc/systemd/system/ && sudo systemctl enable --now capacitylens
   ```

5. Open the address and create your company. The setup token it asks for is the
   `CAPACITYLENS_SETUP_TOKEN` line in `/etc/capacitylens.env`.

## Check that it is healthy

```bash
curl -fsS http://127.0.0.1:8787/api/health
```

Expect `"ok":true`, `"db":true`, `"audit":"ok"` and a `backup` whose `status` is `"ok"`. It reads
`"pending"` for a minute after the first start. Fix a `503`, a degraded field or a restart loop
before you hand over: follow the log with `journalctl -u capacitylens -f`.
[Monitoring and health checks](/self-hosting/monitoring) explains each field.

## HTTPS

Caddy is the shortest route: it obtains and renews the certificate itself. Add this block from
the archive's `Caddyfile.example` to `/etc/caddy/Caddyfile`, with your own hostname:

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

For nginx, the archive's `capacitylens.nginx.conf` is a complete site file: it terminates TLS,
serves the web app, proxies `/api/` and keeps invitation, sign-in and password-reset links out of
the access log. Get a certificate first with your distribution's ACME client, such as certbot.
Copy the file, replace the hostname and certificate paths, and enable it:

```bash
sudo cp /opt/capacitylens/current/capacitylens.nginx.conf /etc/nginx/sites-available/capacitylens
```

```bash
sudo ln -s /etc/nginx/sites-available/capacitylens /etc/nginx/sites-enabled/
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The server sends HSTS itself when `CAPACITYLENS_PUBLIC_URL` is `https`.
[TLS and networking](/self-hosting/tls-and-networking) covers the proxy requirements. Check
through the proxy too:

```bash
curl -fsS https://capacity.example.com/api/health
```

## Hand over the setup token

Send the intended Owner the address and the `CAPACITYLENS_SETUP_TOKEN` value through a private
channel. They enter it once, on the first-owner screen. Do not create the Owner for them.

After the Owner has signed in, delete the `CAPACITYLENS_SETUP_TOKEN` line from
`/etc/capacitylens.env` and restart the service:

```bash
sudo systemctl restart capacitylens
```

First-owner setup is open only while the database holds no users and a token is set. Erasing the
sole identity later reopens it, so set a new token only when you mean to create a new first
Owner. [Verify and hand over](/self-hosting/verify-and-hand-over) finishes the job.

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

## Verify the download

Check the archive against its checksum before you unpack it:

```bash
curl -LO https://github.com/Kevinjohn/capacitylens/releases/download/v0.73.0-alpha.1/capacitylens-0.73.0-alpha.1.tar.gz.sha256
```

```bash
sha256sum -c capacitylens-0.73.0-alpha.1.tar.gz.sha256
```

Next: [Backups and restore](/self-hosting/backups-and-restore) to protect the database, and
[Upgrades](/self-hosting/upgrades) for newer releases.
