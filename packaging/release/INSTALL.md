# Install the native CapacityLens archive

This archive contains the built web app, compiled AdonisJS backend, production dependencies and
SQLite addon for the host architecture on which it was packaged. Use Node 24.19.0 or newer within
24.x. The `VERSION` file identifies the release and source revision.

## One command

On a Linux systemd host with Node 24 and Caddy installed, and DNS for your domain pointing at it,
unpack the archive into `/opt/capacitylens` and run:

```bash
sudo node /opt/capacitylens/capacitylens-X.Y.Z/install.mjs
```

It asks for the public HTTPS address, the Owner's email address and SMTP settings, writes
`/etc/capacitylens.env` with generated secrets, installs and starts the systemd unit, configures
Caddy for automatic HTTPS, enables the daily verified backups and prints the setup link. Use
`--proxy none` with another same-machine proxy, `--dry-run` to preview and `--help` for the
options that replace the questions. Running the same command from a newer release upgrades the
installation; it keeps the environment file and backs up the database before migrating.

## By hand

The backend supports password authentication and native database sessions. The environment example
keeps open access disabled. Set `APP_KEY`, a random `CAPACITYLENS_SECRET` of at least 32 characters,
matching HTTPS `APP_URL` / `CAPACITYLENS_PUBLIC_URL` origins and SMTP delivery before starting.
Invitations, address confirmation and password resets are emailed. After the first start, print the
first-install link for the Owner's email address:

```bash
sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
  -p WorkingDirectory=/opt/capacitylens/current/backend \
  -p EnvironmentFile=/etc/capacitylens.env \
  -p Environment=NODE_ENV=production \
  /usr/bin/env node ace.js account-kit:admission:bootstrap owner@example.com --role=viewer
```

The person who opens the link chooses a password, becomes the Owner and creates the company.

On a fresh Linux systemd host, create the service user and persistent data directories before
starting the application. Keep the database and backups outside the release so they survive
upgrades. The archive contains a `capacitylens-X.Y.Z` directory; the `current` link gives the service
a stable path. Install Node 24 system-wide first.

```bash
sudo useradd --system --home /var/lib/capacitylens --shell /usr/sbin/nologin capacitylens
sudo install -d -m 0755 /opt/capacitylens
sudo install -d -o capacitylens -g capacitylens -m 0700 /var/lib/capacitylens /var/lib/capacitylens/backups
sudo tar -xzf capacitylens-X.Y.Z.tar.gz -C /opt/capacitylens
sudo ln -sfn /opt/capacitylens/capacitylens-X.Y.Z /opt/capacitylens/current
sudo install -o root -g root -m 0600 /opt/capacitylens/current/capacitylens.env.example /etc/capacitylens.env
cd /opt/capacitylens/current/backend && node ace.js generate:key --show
sudoedit /etc/capacitylens.env
```

In the editor, paste the generated `APP_KEY` and set `APP_URL` to your HTTPS address. The sample
binds the backend to loopback port 8787; put HTTPS in front with the supplied Caddy or nginx
example. The environment file stays root-only. Run the upgrade as `capacitylens` through systemd,
which reads that file and gives the service user access to its settings without giving it read
access to the file. The command takes a verified pre-upgrade
snapshot of an existing database before running pending migrations.

```bash
sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
  -p WorkingDirectory=/opt/capacitylens/current/backend \
  -p EnvironmentFile=/etc/capacitylens.env \
  -p Environment=NODE_ENV=production \
  /usr/bin/env node ace.js app:upgrade
sudo cp /opt/capacitylens/current/capacitylens.service /etc/systemd/system/capacitylens.service
sudo systemctl daemon-reload
sudo systemctl enable --now capacitylens
```

For an upgrade, stop the service, unpack the new archive, point `current` to the new release, run
the same `systemd-run` upgrade command, then restart the service. Do not restart if the upgrade
command fails. Use `GET /health/ready` for readiness. An explicit verified backup can run while the
server is online:

```bash
sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
  -p WorkingDirectory=/opt/capacitylens/current/backend \
  -p EnvironmentFile=/etc/capacitylens.env \
  -p Environment=NODE_ENV=production \
  /usr/bin/env node ace.js db:backup create
```

The running server also writes verified READY bundles at startup and every 24 hours to
`CAPACITYLENS_BACKUP_DIR`. The supplied nginx
site serves static assets from `backend/public` and proxies health and API requests; the Caddy example proxies
everything to the backend.

Verify an archive before unpacking it from a directory containing both downloads:

```bash
sha256sum -c capacitylens-X.Y.Z.tar.gz.sha256
```

The archive is platform-specific because it includes a native SQLite addon. Use an archive built
on the same operating system and architecture as the target host.

For sole-Owner recovery, stop the service and run:

```bash
sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens \
  -p WorkingDirectory=/opt/capacitylens/current/backend \
  -p EnvironmentFile=/etc/capacitylens.env \
  -p Environment=NODE_ENV=production \
  /usr/bin/env node ace.js owner:reset-password owner@example.com --confirm-server-stopped
```

Its JSON output contains a single-use reset link that expires after one hour: deliver it privately.
It never sets a password directly.

A database created before password-only sign-in is refused at upgrade. Stop the service, keep the
old file, point `CAPACITYLENS_DB` at a new path, run `app:upgrade`, start the service, bootstrap the
new owner and re-invite testers.
