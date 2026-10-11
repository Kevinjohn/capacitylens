---
title: Deploy on a managed host
description: Install, upgrade and roll back CapacityLens from the release archive on Forge, Ploi, RunCloud and similar platforms, using the platform's own screens.
---

# Deploy on a managed host

The [five install steps](/self-hosting/install) on a server that Laravel Forge, Ploi, RunCloud
or a similar platform manages, in the platform's own screens and with no terminal. About ten
minutes on a site that already exists. Forge is the worked example; other platforms use
different labels for the same things.

## Before you start

- A site created as **Other** or **Custom application**, never Laravel, Symfony, WordPress or
  another framework template, with **Website isolation** switched on. Isolation gives the site
  its own operating-system user for when several installations share a server; it does not
  replace separate servers when strong isolation is required.
- An HTTPS certificate for the site's hostname, issued in the platform's certificate settings.
  If the final DNS record is not ready, use the platform's temporary HTTPS domain and
  [move to the final domain](#move-to-the-final-domain) later. Don't configure company login
  against a temporary domain.
- Node 24.19.0 or newer within 24.x on the server, as shown in the platform's server settings.

`/home/forge/capacity.example.com` stands for your site's folder. `forge` is the site's user; a
site with website isolation uses its own user, so use that name in every `/home/forge` path and
in `CAPACITYLENS_DB`. The commands name release 0.73.0-alpha.1, the first with an archive; for a
newer release, use its version.

## The five steps

1. **Deploy script:** create the data folder, then download, unpack and switch the `current` link
   to the release.

   ```bash
   mkdir -p /home/forge/capacitylens-data
   cd /home/forge/capacity.example.com
   curl -fsSLO https://github.com/Kevinjohn/capacitylens/releases/download/v0.73.0-alpha.1/capacitylens-0.73.0-alpha.1.tar.gz
   tar -xzf capacitylens-0.73.0-alpha.1.tar.gz && ln -sfn capacitylens-0.73.0-alpha.1 current
   ```

   Run the deploy once. To upgrade later, follow [Upgrade](#upgrade).

2. **Data folder:** `/home/forge/capacitylens-data`, outside the release so upgrades keep it.
   The deploy script's first line creates it. The database, the audit log and the scheduled
   backups (in its `backups` folder) live here. Never put the database under a release folder or
   `current/`: release folders are replaced and deleted.

3. **Environment:** run `init` once in the site's command runner (Forge: the site's Commands
   panel, which starts in the site's folder), with your address:

   ```bash
   node current/server/dist/index.mjs init --public-url https://capacity.example.com --db /home/forge/capacitylens-data/capacitylens.db
   ```

   It prints five lines, with the session secret and the Owner's one-time setup token generated.
   Paste them into the site's environment editor, and store the setup token in a password
   manager before you save. The server refuses to start while the address, the secret or the
   token is empty, and names the missing one. Never commit the secret or the token, or paste
   them into deployment logs, support messages or issue reports.

   The editor saves the site's `.env`, one level above `current`, so every release reads the same
   file. Keep `NODE_ENV=production` on the API process: the line from `init` sets it, and
   production mode turns on scheduled backups, structured logs, deep health and rate limiting by
   default.

   For a single-company installation, add nothing else and leave these unset:
   `VITE_CAPACITYLENS_DEMO`, `CAPACITYLENS_SEED_DEMO`, `CAPACITYLENS_MULTI_ACCOUNT`,
   `CAPACITYLENS_BOOTSTRAP_TOKEN` and `CAPACITYLENS_ALLOW_OPEN_SIGNUP`. If the platform already
   sends an HSTS header, add `CAPACITYLENS_HTTPS=0` to avoid a duplicate.

   ::: warning Quote values pasted from elsewhere
   Node cuts an unquoted `.env` value short at `#`, and the server then starts with the wrong
   secret instead of failing. The secrets `init` generates are safe unquoted. Wrap anything
   pasted from elsewhere, such as a company-login client secret, in single quotes:

   ```dotenv
   CAPACITYLENS_GOOGLE_CLIENT_SECRET='the value exactly as issued'
   ```

   :::

4. **Background process (daemon) and nginx:** create one background process that runs as the
   site's user, with the directory `/home/forge/capacity.example.com/current`, one process, a
   stop wait of more than 10 seconds and this command:

   ```bash
   node --env-file=../.env server/dist/index.mjs
   ```

   The server needs those seconds to finish in-flight requests and backup work when it stops.
   Record the platform's name for the process (Forge: its Supervisor group, such as
   `daemon-1234567`).

   Then, in the site's nginx file, replace the generated `location /` block with these
   locations, which send every request to the server. Keep the platform's other generated lines,
   such as includes, TLS directives and Forge's `# FORGE CONFIG` comments, so the platform can
   keep managing certificates. Do not add a second `location /`: it fails the platform's
   configuration test.

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

   The first location is the whole proxy. Keep the three `access_log off` locations: without
   them, anyone who can read the access log could use the links in it to accept an invitation or
   reset a password.

   Save through the platform, which tests and reloads nginx. If it does not test first, run this
   and reload only after it succeeds:

   ```bash
   sudo nginx -t
   ```

   The server listens on `127.0.0.1` by default, so it trusts the forwarded headers nginx sets,
   and rate limits and audit records show the real visitor address. Keep it on loopback;
   [TLS and networking](/self-hosting/tls-and-networking) covers the alternatives.

5. **Open the address** and check the first-Owner screen loads. Use it only once the address is
   HTTPS and matches `CAPACITYLENS_PUBLIC_URL` exactly. If you are also the Owner, continue with
   [Set up your company](/owner/) and the setup token from step 3; otherwise,
   [hand over](#hand-over-to-the-first-owner).

::: warning One process per database
Exactly one CapacityLens process may use a database. Switch off any zero-downtime deploy that
starts the new release beside the old one, and restart the background process after the deploy
script instead.
:::

## After the first start

Open `https://capacity.example.com/api/health`, with your own address. Expect `"ok":true`,
`"db":true`, `"audit":"ok"` and a `backup` whose `status` is `"ok"`; it reads `"pending"` for a
moment after the first start. Treat `degraded`, or `pending` that lasts longer than one backup
interval (60 minutes by default), as a failure;
[Monitoring and health checks](/self-hosting/monitoring#what-each-field-means-and-when-to-alert)
defines the alerts.

If the request fails, read the background-process log and fix the first startup error before
editing nginx. Some command runners show their own temporary output-file error after a command
finishes; that does not prove the server failed. To rule nginx out, run this in the command
runner:

```bash
curl -fsS http://127.0.0.1:8787/api/health
```

Open the address in a private window: the first-Owner screen must load, and refreshing a nested
route must return the app rather than an nginx `404`.

Set the platform's post-deployment or uptime health URL to
`https://capacity.example.com/api/health`. Use the public HTTPS address, not the loopback port, so
the check proves DNS, TLS, nginx, the server and the database together.

## Hand over to the first Owner

If you are not the Owner, send them the address and [Set up your company](/owner/), and send the
setup token separately and privately. The Owner then creates their own sign-in and company.

Once the Owner can sign in, remove `CAPACITYLENS_SETUP_TOKEN` from the environment, restart the
background process and check health. Destroy the transferred copy unless your recovery policy
needs a protected record. First-Owner setup is open only while the database holds no users and a
token is set, so erasing the sole identity reopens it while the token remains.
[Verify and hand over](/self-hosting/verify-and-hand-over) has the full checklist.

## Move to the final domain

Skip this if the site already uses its final domain.

1. Add the final domain to the site and create the DNS record the platform asks for. Once DNS
   resolves to this server, issue the certificate and check the new address in a browser. Keep
   the temporary domain enabled for now.
2. Change `CAPACITYLENS_PUBLIC_URL` to the final address: scheme and hostname only, with no path
   or trailing slash. Change the platform's health-check URL at the same time.
3. Restart the background process and check `/api/health` on the new address. Existing sessions
   belong to the old address, so everyone signs in again.
4. Ask the Owner to sign in on the final domain and make one safe change. Then disable the
   temporary domain, or make it redirect to the final address rather than serve a second copy.

## Add company login

Add company login only once the final address is stable. Before changing sign-in settings, stop
the background process and keep a complete recovery bundle off the server: the database with its
`-wal` and `-shm` files, and the current and rotated audit logs. A database file copied by itself
is not a complete recovery point. Start the background process again and check `/api/health`.

Then follow [Set up Google or Microsoft sign-in](/company-login/set-up-company-login). The
callback origin must match `CAPACITYLENS_PUBLIC_URL` character for character. Sign-in is
configured per installation; enabling it on one does not change another on the same server.

<span id="deploy-and-upgrade-safely"></span>

## Upgrade

[Upgrades](/self-hosting/upgrades) has the full procedure. On a managed host:

1. Read the target release's `CHANGELOG.md` entry for schema changes or operator actions.
   Confirm health is `"ok"` and a recent restore test exists.
2. Take a fresh snapshot. There is no "snapshot now" button: the server writes a verified
   snapshot when it starts, and every `CAPACITYLENS_BACKUP_INTERVAL_MIN` minutes after that.
   Restart the background process, wait for the attempt to finish, then confirm the backup
   folder contains the new verified file. Or use the latest scheduled snapshot if it is only
   minutes old and nothing important has been written since. List the backup folder newest first:

   ```bash
   ls -lt /home/forge/capacitylens-data/backups | head -3
   ```

   Filenames carry a UTC timestamp: `capacitylens-utc-20260911-140233-118.db` was written at
   14:02:33 UTC on 11 September 2026. Copy the newest one off the server. Run this on your own
   machine:

   ```bash
   scp forge@your-server:/home/forge/capacitylens-data/backups/capacitylens-utc-YYYYMMDD-HHMMSS-sss.db .
   ```

3. Change the version in the deploy script's `curl` and `tar` lines, run the deploy, then
   restart the background process. The restart stops the old release before the new one starts.
4. Check health, sign in, confirm the company opens, read existing data and make one safe change
   that survives a refresh. Check the process log for restart loops, migration failures or
   security errors, and confirm a new scheduled backup succeeds.

Keep the previous release folder and the snapshot until those checks pass. Then delete older
release folders and archives from the site folder, never the one `current` points at.

::: warning Never copy the live database file
Do not `cp` or `scp` `capacitylens.db` while the server is running. SQLite keeps recent writes in
a separate `-wal` file, so the copy can be missing data or inconsistent, and you won't find out
until the restore fails. Copy an integrity-checked snapshot from the backup folder, or stop the
server first. [Backups and restore](/self-hosting/backups-and-restore) covers both.
:::

## Roll back

With a schema change, switching code alone is not a rollback: never start the old release against
a database the new one has migrated. Put back the `capacitylens-pre-migration-vN-to-vM.db`
snapshot the new release wrote in the backup folder. Everything written since the upgrade is lost.
Without a schema change there is no such snapshot; skip steps 2 to 4.

1. Stop the background process in the platform's daemon screen.
2. In the command runner, preserve the upgraded database:

   ```bash
   rollback_dir="/home/forge/capacitylens-data/rolled-back-$(date -u +%Y%m%d-%H%M%S)" && mkdir -m 700 "$rollback_dir" && cp -p /home/forge/capacitylens-data/capacitylens* "$rollback_dir"/
   ```

3. List the pre-migration snapshots:

   ```bash
   ls -l /home/forge/capacitylens-data/backups/capacitylens-pre-migration-*.db
   ```

4. Copy the one this upgrade wrote over the database, and remove the upgraded database's `-wal`
   and `-shm` files:

   ```bash
   cp /home/forge/capacitylens-data/backups/capacitylens-pre-migration-vN-to-vM.db /home/forge/capacitylens-data/capacitylens.db && rm -f /home/forge/capacitylens-data/capacitylens.db-wal /home/forge/capacitylens-data/capacitylens.db-shm
   ```

5. Point `current` back at the previous release. Replace `X.Y.Z` with the previous version:

   ```bash
   ln -sfn capacitylens-X.Y.Z current
   ```

6. Change the version in the deploy script's `curl` and `tar` lines back to `X.Y.Z`, so the next
   deploy does not reinstate the new release. Undo any environment change the new release needed.
7. Start the background process and check `/api/health`, then sign in and confirm the company
   opens.

<span id="keep-operator-tooling-in-a-separate-maintenance-checkout"></span>

## Run recovery commands

The release holds no pnpm, `tsx` or development packages. Recovery commands written as
`pnpm --filter capacitylens-server ...` run from a separate maintenance checkout, never from
`current/`:

1. Check out the release serving production, or for a
   [migration rehearsal](/reference/development#rehearse-migrations) the target release, in a
   protected folder outside every release folder. Run `pnpm install --frozen-lockfile` there.
2. Stop the background process before any command that writes to the database. Pass the
   database, backup and evidence paths as absolute paths; don't copy them into the checkout.
3. Run the command, complete its verification, then start the background process and check it.
4. Delete the checkout when you are done. Never point nginx or the background process at it, and
   never start a second server from it against the production database.

[When something goes wrong](/self-hosting/incidents) has the command-specific safeguards.

<span id="finish-and-operate-the-installation"></span>

## Keep it running

- **Continuously:** poll the public `/api/health` address.
- **Weekly:** review deep health, process restarts, disk space, audit size and backup freshness.
- **Monthly:** restore a snapshot to a temporary location and complete a restore test.
- **Every release:** follow [Upgrade](#upgrade).
- **After a domain or sign-in change:** test sign-in and session revocation in a private browser
  window.

For process status and logs, use the platform's daemon status and log view.
[Monitoring and health checks](/self-hosting/monitoring) explains every health field and alert.

Each installation on a server needs its own site user, domain, data folder, secrets and port. For
a second installation, add `PORT=8788` (or another free port) to its environment and use that
port in its nginx locations. Installations never share sessions, identities, secrets or
databases. Site users isolate files and permissions, not CPU, memory or the kernel: watch memory,
disk space and restart loops, and move an installation to its own server if it can exhaust
resources another needs.

Keep a private record per installation: domains, site user and folder, port, process name,
release version, data and backup paths, latest backup and restore test, company-login callback
when enabled, and who is responsible for releases. Keep secret values in a password manager or
the platform's secret store, not in this record.

## Run your own changes

To run CapacityLens from a clone with your own changes, use the
[development guide](/reference/development). There is no separate managed-host build route.
