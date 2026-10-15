# Install the native CapacityLens archive

This archive contains the built web app, compiled AdonisJS backend, production dependencies and
SQLite addon for the host architecture on which it was packaged. Use Node 24.19.0 or newer within
24.x. The `VERSION` file identifies the release and source revision.

The current backend uses open local access. Until the account kit is integrated, put it behind a
trusted access boundary and set `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1` deliberately. The archive
does not contain the older password and company-provider setup commands. The environment example
disables this opt-in, so the production service refuses to start until you enable it. HTTPS alone
does not restrict access; the supplied Caddy and nginx examples do not authenticate visitors.

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
example. Before enabling `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1`, restrict access to trusted
users through your access boundary. The environment file stays root-only. Run the upgrade as `capacitylens` through systemd,
which reads that file and gives the service user access to its settings without giving it read
access to the file. The command checks the released migration manifest and takes a verified
pre-upgrade snapshot when migrations are pending on an existing database.

```bash
sudo systemd-run --pipe --wait --collect --quiet --uid=capacitylens -p WorkingDirectory=/opt/capacitylens/current/backend -p EnvironmentFile=/etc/capacitylens.env /usr/bin/env node ace.js app:upgrade
sudo cp /opt/capacitylens/current/capacitylens.service /etc/systemd/system/capacitylens.service
sudo systemctl daemon-reload
sudo systemctl enable --now capacitylens
```

For an upgrade, stop the service, unpack the new archive, point `current` to the new release, run
the same `systemd-run` upgrade command, then restart the service. Do not restart if the upgrade
command fails. Use `GET /health/ready` for readiness. An explicit verified backup uses the same
`systemd-run` command with `db:backup` in place of `app:upgrade`. The running server also writes
periodic verified snapshots to `CAPACITYLENS_BACKUP_DIR`. The supplied nginx site serves static
assets from `backend/public` and proxies health and API requests; the Caddy example proxies
everything to the backend.

Verify an archive before unpacking it from a directory containing both downloads:

```bash
sha256sum -c capacitylens-X.Y.Z.tar.gz.sha256
```

The archive is platform-specific because it includes a native SQLite addon. Use an archive built
on the same operating system and architecture as the target host.
