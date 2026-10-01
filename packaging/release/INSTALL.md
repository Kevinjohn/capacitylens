# Install CapacityLens

Five steps on every host. You fill in three values and run one command per step. Only step 4
differs between hosts.

1. **Download** the release archive and unpack it.
2. **Pick a folder for its data.** The database file is created there on first start.
3. **Configure.** Copy `capacitylens.env.example` and fill in its three empty lines: the address,
   and two values pasted from `openssl rand -base64 48`. Everything else has a default.
4. **Start it.**
5. **Open the address** and create your company. The setup token is the `SETUP_TOKEN` line from
   step 3.

You need Node 24 on the system path and a hostname pointing at the host. The archive is tested on
Ubuntu x86-64; other Linux distributions and macOS are expected to work but are not tested.
The commands below name release X.Y.Z. For a newer release, use its version instead; the `VERSION`
file in the archive names the one you have.

## Managed host (Forge and similar), no terminal

`/home/forge/capacity.example.com` stands for your site's folder; use yours.

1. **Deploy script:** download, unpack and switch the `current` link to the new release.

   ```bash
   cd /home/forge/capacity.example.com
   curl -fsSLO https://github.com/Kevinjohn/capacitylens/releases/download/vX.Y.Z/capacitylens-X.Y.Z.tar.gz
   tar -xzf capacitylens-X.Y.Z.tar.gz && ln -sfn capacitylens-X.Y.Z current
   ```

   To upgrade, run the deploy script with the new version, then restart the background process
   from step 4 so it runs the new release.

2. **Data folder:** `/home/forge/capacitylens-data`, outside the release so upgrades keep it.
   Create it once from the host's file manager or its command box: `mkdir -p /home/forge/capacitylens-data`.
3. **Environment:** paste the lines of `capacitylens.env.example` into the site's environment
   editor, fill in the three empty lines and set
   `CAPACITYLENS_DB=/home/forge/capacitylens-data/capacitylens.db`.
4. **Background process (daemon):** directory `/home/forge/capacity.example.com/current`, command:

   ```bash
   node --env-file=../.env server/dist/index.mjs
   ```

   In the site's nginx file, send every request to the server; it serves the web app itself:

   ```nginx
   client_max_body_size 6m;
   location / {
       proxy_pass http://127.0.0.1:8787;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $remote_addr;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_read_timeout 130s;
   }
   # These request lines carry single-use invitation, sign-in and password-reset secrets.
   location ~ ^/api/invites/[^/]+/(accept|signup|preview)$ {
       access_log off;
       proxy_pass http://127.0.0.1:8787;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $remote_addr;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_read_timeout 130s;
   }
   location ~ ^/api/auth/(callback|oauth2/callback)/ {
       access_log off;
       proxy_pass http://127.0.0.1:8787;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $remote_addr;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_read_timeout 130s;
   }
   location ~ ^/(invite|reset-password)/ {
       access_log off;
       proxy_pass http://127.0.0.1:8787;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $remote_addr;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_read_timeout 130s;
   }
   ```

   Keep the three `access_log off` locations: without them, the host's access log records links
   that anyone reading it could use to accept an invitation or reset a password.

5. **Open the address** and create your company with the setup token from step 3.

## Linux host with systemd

Each `sudo` line does what a managed host does when you create a site: a user, a folder, a
service and a proxy. Install Node 24 system-wide first (NodeSource or the official tarball into
`/usr/local`). If you use nvm, copy its binary once:
`sudo install -D -m 0755 "$(command -v node)" /usr/local/bin/node`.

```bash
# 1. Download and unpack
curl -LO https://github.com/Kevinjohn/capacitylens/releases/download/vX.Y.Z/capacitylens-X.Y.Z.tar.gz
sudo mkdir -p /opt/capacitylens && sudo tar -xzf capacitylens-X.Y.Z.tar.gz -C /opt/capacitylens && sudo ln -sfn /opt/capacitylens/capacitylens-X.Y.Z /opt/capacitylens/current
# 2. A user and a folder for its data (the database file appears here on first start)
sudo useradd --system --home /var/lib/capacitylens --shell /usr/sbin/nologin capacitylens
sudo install -d -o capacitylens -g capacitylens -m 0700 /var/lib/capacitylens
# 3. Configure: fill in the address and paste two values from `openssl rand -base64 48`
sudo sh -c 'umask 077 && cp -n /opt/capacitylens/current/capacitylens.env.example /etc/capacitylens.env' && sudo nano /etc/capacitylens.env
# 4. Start it, then put HTTPS in front (below)
sudo cp /opt/capacitylens/current/capacitylens.service /etc/systemd/system/ && sudo systemctl enable --now capacitylens
# 5. Open the address. The setup token is the SETUP_TOKEN line in /etc/capacitylens.env
```

For HTTPS, Caddy is the shortest route: add the four-line block from `Caddyfile.example` to
`/etc/caddy/Caddyfile` with your hostname, then `sudo systemctl reload caddy`. Caddy obtains the
certificate itself. For nginx, use `capacitylens.nginx.conf`; its first lines say how.

## Docker Compose

Follow [Install with Docker](https://kevinjohn.github.io/capacitylens/self-hosting/install-with-docker.html)
in the documentation. It builds from a checkout rather than from this archive.

## On a laptop, or for an agent

Save the five lines as `capacitylens.env` beside the unpacked folder, with
`SMALLSASS_ACCOUNT_PUBLIC_URL=http://localhost:8787` and a `CAPACITYLENS_DB` path you can write,
then run from the unpacked folder:

```bash
node --env-file=../capacitylens.env server/dist/index.mjs
```

## Optional

Verify the download before unpacking it:

```bash
curl -LO https://github.com/Kevinjohn/capacitylens/releases/download/vX.Y.Z/capacitylens-X.Y.Z.tar.gz.sha256
sha256sum -c capacitylens-X.Y.Z.tar.gz.sha256
```

Check the running server. Expect `"ok":true`, `"db":true`, `"audit":"ok"` and a `backup` whose
`status` is `"ok"` (it reads `"pending"` for a moment after the first start):

```bash
curl -fsS http://127.0.0.1:8787/api/health
```

Write `/etc/capacitylens.env` in one command instead of step 3, with fresh secrets. It refuses to
overwrite an existing file, so running it again cannot replace keys. Change the address first:

```bash
sudo sh -c 'set -C; umask 077; secret="$(openssl rand -base64 48)" && token="$(openssl rand -base64 48)" && printf "NODE_ENV=production\nSMALLSASS_ACCOUNT_PUBLIC_URL=https://capacity.example.com\nSMALLSASS_ACCOUNT_SECRET=%s\nSMALLSASS_ACCOUNT_SETUP_TOKEN=%s\nCAPACITYLENS_DB=/var/lib/capacitylens/capacitylens.db\n" "$secret" "$token" > /etc/capacitylens.env'
```

Recover a lost Owner password. Stop the service first. The single-use reset link is printed to
your terminal only, never to the journal; give it to the Owner over a channel you trust:

```bash
sudo systemctl stop capacitylens
sudo systemd-run --pipe --wait --quiet --uid=capacitylens -p EnvironmentFile=/etc/capacitylens.env /usr/bin/env node /opt/capacitylens/current/server/dist/reset-owner-password.mjs /var/lib/capacitylens/capacitylens.db owner@example.com --confirm-server-stopped; echo "exit status $?"
sudo systemctl start capacitylens
```

An exit status other than 0 means no link was issued; the message above it says why.
