---
title: Install without Docker
description: Install CapacityLens directly on a Linux host with Node 24, pnpm and nginx — no Docker required.
prev:
  text: Choose how to install
  link: /getting-started/install
next:
  text: Configure the service
  link: /installation/configure-the-service
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

1. Create `/opt/capacitylens` for your own account, clone the repository into it, check out
   the release you're deploying and select Node 24:

   ```bash
   sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0755 /opt/capacitylens
   git clone https://github.com/Kevinjohn/capacitylens.git /opt/capacitylens
   cd /opt/capacitylens
   git checkout vX.Y.Z
   nvm install
   nvm use
   node --version
   corepack enable
   ```

   Replace `vX.Y.Z` with the release tag you're deploying. The newest is on the
   [releases page](https://github.com/Kevinjohn/capacitylens/releases/latest). Don't deploy
   `main`: it carries changes that haven't been released yet.

   The service and nginx configuration below use these `/opt/capacitylens` paths. Your account
   owns the clone and builds it. The `capacitylens` service user needs to read the clone,
   and nginx needs to reach `dist/` inside it. Git leaves the files readable by every account,
   so this works as written. If you clone somewhere else, every directory above the clone must
   let other accounts through; a clone under a `0750` home directory fails at start.

   nvm reads `.nvmrc` from the repository, so run it after changing into the cloned
   directory. The reported version must be `v24.x`; the server refuses to start with
   an older version.

2. Install dependencies and copy the example environment file:

   ```bash
   pnpm install --frozen-lockfile
   cp .env.example .env
   chmod 600 .env
   ```

   `.env` will hold the session-signing secret and the setup token, so only your account may
   read it. systemd reads the file as root before it starts the service, so the service user
   doesn't need access.

3. Generate two secrets:

   ```bash
   openssl rand -base64 48
   ```

   Run it twice and set at least these values in `.env` — the same ones the Docker
   install uses, plus the bare-metal-only path and host settings:

   ```dotenv
   SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE=self-hosted-password
   SMALLSASS_ACCOUNT_MODE=password-only
   SMALLSASS_ACCOUNT_SECRET=<first generated value>
   SMALLSASS_ACCOUNT_PUBLIC_URL=https://capacity.example.com
   SMALLSASS_ACCOUNT_SETUP_TOKEN=<second generated value>
   CAPACITYLENS_RATE_LIMIT=300
   CAPACITYLENS_DB=/var/lib/capacitylens/capacitylens.db
   CAPACITYLENS_AUDIT_FILE=/var/lib/capacitylens/capacitylens-audit.jsonl
   CAPACITYLENS_BACKUP_DIR=/var/lib/capacitylens/backups
   CAPACITYLENS_HOST=127.0.0.1
   PORT=8787
   ```

   Unlike Docker Compose, nothing loads `.env` for you automatically here — the systemd
   unit in step 5 reads it directly with `EnvironmentFile`. See
   [Configure the service](/installation/configure-the-service) for what every variable does.
   Set `CAPACITYLENS_STORAGE_ENCRYPTED=1` only after verifying that `/var/lib/capacitylens`
   and the backup destination use encrypted storage at rest; the setting is an attestation,
   not an encryption mechanism.

   Create a dedicated system user and a data directory it owns:

   ```bash
   sudo useradd --system --home /var/lib/capacitylens --shell /usr/sbin/nologin capacitylens
   sudo install -d -o capacitylens -g capacitylens /var/lib/capacitylens /var/lib/capacitylens/backups
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
   `/etc/systemd/system/capacitylens.service`. Its paths match the clone from step 1 and the
   runtime installed in step 3:

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
   Environment=NODE_ENV=production
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

6. Obtain a certificate for the final hostname using your distribution's supported ACME
   client, then configure nginx to serve the built app over HTTPS and proxy `/api/` to
   the API. Create `/etc/nginx/sites-available/capacitylens`, pointing `root` at the
   `dist/` directory from step 4:

   ```nginx
   server {
       listen 443 ssl;
       listen [::]:443 ssl;
       server_name capacity.example.com;

       ssl_certificate /etc/letsencrypt/live/capacity.example.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/capacity.example.com/privkey.pem;

       root /opt/capacitylens/dist;
       index index.html;

       location /api/ {
           proxy_pass http://127.0.0.1:8787;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $remote_addr;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       location / {
           try_files $uri $uri/ /index.html;
       }
   }

   server {
       listen 80;
       listen [::]:80;
       server_name capacity.example.com;
       return 301 https://$host$request_uri;
   }
   ```

   Enable it and reload nginx:

   ```bash
   sudo ln -s /etc/nginx/sites-available/capacitylens /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

   After the certificate and redirect work, add `CAPACITYLENS_HTTPS=1` to `.env` and
   restart the service. The API remains on loopback HTTP; nginx terminates public TLS and
   overwrites the forwarded headers. See [Secure the connection](/installation/secure-the-connection)
   for the same-origin boundary and certificate renewal requirements.

7. Check the API locally and through the public HTTPS origin:

   ```bash
   curl -fsS http://127.0.0.1:8787/api/health
   ```

   ```bash
   curl -fsS https://capacity.example.com/api/health
   ```

   Both responses should start `{"ok":true,...}`. Open the public HTTPS origin and confirm
   that a nested app route refreshes without an nginx `404`. Complete the [verify and hand
   over](/installation/verify-and-hand-over) procedure before giving the address or setup
   details to the first Owner.

To install a newer release later, follow the native steps in [Upgrades](/self-hosting/upgrades).

## What's next

- [Secure the connection](/installation/secure-the-connection) to put a real certificate in
  front of this host — required before anyone outside your network reaches it.
- [Backups and restore](/self-hosting/backups-and-restore) to protect the database this
  install just created.
