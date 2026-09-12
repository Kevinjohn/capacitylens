---
title: Install without Docker
description: Install CapacityLens directly on a Linux host with Node 24, pnpm and nginx — no Docker required.
---

# Install without Docker

This installs CapacityLens straight onto a Linux host: Node 24 runs the API as a
systemd service, and nginx serves the built app and proxies `/api/` to it. No Docker
installation is needed. Budget 20–30 minutes on a host that already has Node and nginx
installed.

## Prerequisites

- A Linux host with systemd and nginx installed (Debian/Ubuntu: `apt install nginx`).
- git, and a way to install the exact Node version the repo pins in `.nvmrc` (Node 24).
  A version manager like [nvm](https://github.com/nvm-sh/nvm) is the easiest way to
  match it.
- Corepack, which ships with Node 24, to get the pinned pnpm version automatically.
- Read [Before you start](/self-hosting/) if you haven't already.

## Steps

1. Clone the repository and select Node 24:

   ```bash
   git clone https://github.com/Kevinjohn/capacitylens.git
   cd capacitylens
   nvm install
   nvm use
   node --version
   corepack enable
   ```

   nvm reads `.nvmrc` from the repository, so run it after changing into the cloned
   directory. The reported version must be `v24.x`; the server refuses to start with
   an older version.

2. Install dependencies and copy the example environment file:

   ```bash
   pnpm install --frozen-lockfile
   cp .env.example .env
   ```

3. Generate two secrets:

   ```bash
   openssl rand -base64 48
   ```

   Run it twice and set at least these values in `.env` — the same ones the Docker
   install uses, plus the bare-metal-only path and host settings:

   ```dotenv
   SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE=self-hosted-password
   SMALLSASS_ACCOUNT_MODE=password
   SMALLSASS_ACCOUNT_SECRET=<first generated value>
   SMALLSASS_ACCOUNT_PUBLIC_URL=https://capacity.example.com
   SMALLSASS_ACCOUNT_SETUP_TOKEN=<second generated value>
   CAPACITYLENS_HTTPS=1
   CAPACITYLENS_RATE_LIMIT=300
   CAPACITYLENS_DB=/var/lib/capacitylens/capacitylens.db
   CAPACITYLENS_HOST=127.0.0.1
   PORT=8787
   ```

   Unlike Docker Compose, nothing loads `.env` for you automatically here — the systemd
   unit in step 5 reads it directly with `EnvironmentFile`. See
   [Configuration](/self-hosting/configuration) for what every variable does.

   Create a dedicated system user and a data directory it owns:

   ```bash
   sudo useradd --system --home /var/lib/capacitylens --shell /usr/sbin/nologin capacitylens
   sudo mkdir -p /var/lib/capacitylens
   sudo chown capacitylens:capacitylens /var/lib/capacitylens
   ```

   Copy the selected Node binary to a root-owned path that the service user can run:

   ```bash
   sudo install -D -m 0755 "$(command -v node)" /opt/capacitylens/bin/node
   sudo -u capacitylens /opt/capacitylens/bin/node --version
   ```

4. Build the web app and the server:

   ```bash
   pnpm run build
   pnpm --filter capacitylens-server run build:runtime
   ```

   The first command builds the single-page app into `dist/` at the repo root — this is
   what nginx serves in step 6. The second bundles the API into
   `server/dist/index.mjs`, the same build Docker's image runs.

5. Install a systemd unit so the API starts on boot and restarts if it exits. Create
   `/etc/systemd/system/capacitylens.service`. Adjust `WorkingDirectory` and
   `EnvironmentFile` to where you cloned the repo, but keep `ExecStart` at the runtime
   path installed in step 3:

   ```ini
   [Unit]
   Description=CapacityLens API
   After=network.target

   [Service]
   Type=simple
   User=capacitylens
   Group=capacitylens
   WorkingDirectory=/opt/capacitylens/server
   EnvironmentFile=/opt/capacitylens/.env
   ExecStart=/opt/capacitylens/bin/node dist/index.mjs
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

   Then start it:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now capacitylens
   sudo systemctl status capacitylens
   ```

   Expect `active (running)` with no restart loop. Follow the logs with
   `journalctl -u capacitylens -f` — like the Docker install, there's no single "ready"
   line, so a quiet log with no restart is what you're looking for. To confirm it's
   running the copied binary, `sudo readlink /proc/$(systemctl show -p MainPID --value
   capacitylens)/exe` should print `/opt/capacitylens/bin/node`.

6. Configure nginx to serve the built app and proxy `/api/` to the API. Create
   `/etc/nginx/sites-available/capacitylens`, pointing `root` at the `dist/` directory
   from step 4:

   ```nginx
   server {
       listen 80;
       server_name capacity.example.com;

       root /opt/capacitylens/dist;
       index index.html;

       location /api/ {
           proxy_pass http://127.0.0.1:8787;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $remote_addr;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       location / {
           try_files $uri $uri/ /index.html;
       }
   }
   ```

   Enable it and reload nginx:

   ```bash
   sudo ln -s /etc/nginx/sites-available/capacitylens /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

   This config is deliberately plain HTTP on port 80, to get the app running end to end
   first. Put real TLS in front of it before the host is reachable from the internet —
   see [TLS and networking](/self-hosting/tls-and-networking) for the certificate setup
   and the exact `X-Forwarded-Proto`/HSTS/security-header details a production config
   needs, which this step intentionally leaves out.

7. Check it's serving:

   ```bash
   curl -fsS http://127.0.0.1/api/health
   ```

   Expected output starts `{"ok":true,...}`. Once TLS is in front of it, open the app
   through your domain and enter the exact `SMALLSASS_ACCOUNT_SETUP_TOKEN` value from the server
   `.env` file as the first owner. Transfer it through a secure channel and never include it in logs,
   tickets or screenshots. Do not paste surrounding quotes or whitespace. After the owner account
   and first company exist, remove the variable from `.env` and restart the server to invalidate the
   handoff secret. See [Configuration](/self-hosting/configuration#sign-in-mode).

After changing Node with nvm during an upgrade, redo the binary copy from step 3 and restart the
service.

## What's next

- [TLS and networking](/self-hosting/tls-and-networking) to put a real certificate in
  front of this host — required before anyone outside your network reaches it.
- [Backups and restore](/self-hosting/backups-and-restore) to protect the database this
  install just created.
