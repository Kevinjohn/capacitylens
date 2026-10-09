---
title: Deploy on a managed VPS platform
description: Install CapacityLens on Forge, Ploi, RunCloud and similar platforms in five steps, using only the platform's own screens.
---

# Deploy on a managed VPS platform

This installs CapacityLens on a server that a platform such as Laravel Forge, Ploi or RunCloud
manages for you. It takes the five steps from [Install CapacityLens](/self-hosting/install),
in the platform's own labels, and needs no terminal. The target is ten minutes on a site that
already exists.

Laravel Forge is the worked example. Other platforms use different labels for the same five
things.

## Before you start

- A site on the server: create an **Other** or **Custom application** site, never a PHP framework
  template, with the platform's website isolation switched on. Its HTTPS certificate and hostname
  come from the platform.
- Node 24 on the server. The platform's server settings show the installed version.
- Nothing to build: the archive holds the built app, the server and the pieces it needs.

`/home/forge/capacity.example.com` below stands for your site's folder; use yours. `forge` is
the site's user; a site with website isolation uses its own user, so use that name in every
`/home/forge` path below and in `CAPACITYLENS_DB`. The commands
name release 0.73.0-alpha.1, the first to carry the archive. For a newer release, use its
version instead.

## The five steps

1. **Deploy script:** create the data folder, then download, unpack and switch the `current` link
   to the release.

   ```bash
   mkdir -p /home/forge/capacitylens-data
   cd /home/forge/capacity.example.com
   curl -fsSLO https://github.com/Kevinjohn/capacitylens/releases/download/v0.73.0-alpha.1/capacitylens-0.73.0-alpha.1.tar.gz
   tar -xzf capacitylens-0.73.0-alpha.1.tar.gz && ln -sfn capacitylens-0.73.0-alpha.1 current
   ```

   Run the deploy once. To upgrade later, run it with the new version, then restart the
   background process from step 4 so it runs the new release.

2. **Data folder:** `/home/forge/capacitylens-data`, outside the release so upgrades keep it.
   The first line of the deploy script creates it, so there is nothing to do by hand.

3. **Environment:** run `init` once in the site's command runner (Forge: the site's Commands
   panel, which starts in the site's folder), with your address:

   ```bash
   node current/server/dist/index.mjs init --public-url https://capacity.example.com --db /home/forge/capacitylens-data/capacitylens.db
   ```

   It prints five lines with the session secret and the one-time setup token for your Owner
   generated. Paste them into the site's environment editor.

   Store the setup token in a password manager before you save. The server refuses to start
   while the address, the secret or the token is empty, and names the one that is missing.

4. **Background process (daemon) and nginx:** create one background process that runs as the
   site's user, with the directory `/home/forge/capacity.example.com/current` and this command:

   ```bash
   node --env-file=../.env server/dist/index.mjs
   ```

   Then, in the site's nginx file, replace the generated `location /` block with these
   locations, which send every request to the server. It serves the web app itself. Keep the
   platform's other generated lines, and do not add a second `location /`, which fails the
   platform's configuration test:

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

   The first location is the whole proxy. Keep the three `access_log off` locations too: without
   them, the host's access log records links that anyone reading it could use to accept an
   invitation or reset a password.

5. **Open the address** and create your company with the setup token from step 3. The
   [Owner guide](/owner/) takes over from there.

::: warning One process per database
Exactly one CapacityLens process may use a database. If the platform offers a zero-downtime
deploy that starts the new release beside the old one, switch it off for this site. Restart
the background process after the deploy script instead.
:::

## After the first start

Check that the server is healthy: open `https://capacity.example.com/api/health` in a browser,
with your own address. Expect `"ok":true`, `"db":true`, `"audit":"ok"` and a `backup` whose `status` is `"ok"`. It reads
`"pending"` for a moment after the first start.

Then work through these pages:

- [Verify and hand over](/self-hosting/verify-and-hand-over) gives the Owner the setup token,
  then removes it from the environment once they have signed in.
- [Upgrades](/self-hosting/upgrades) and
  [Backups and restore](/self-hosting/backups-and-restore) are the routine for a running site.
- [Configuration](/self-hosting/configuration) lists every setting, including
  company login.

## Long-form pages

These pages build CapacityLens from a tagged source checkout, which the archive makes
unnecessary. They remain as the long-form reference for a platform that must build, for a
release that predates the archive, and for the operating routine on a shared server:

1. [Choose the release source](/self-hosting/managed-vps/choose-the-release-source) — pin
   releases and prevent automatic deployment from the public project.
2. [Create and build the site](/self-hosting/managed-vps/create-and-build-the-site) — map
   CapacityLens onto the platform's site and release-directory settings.
3. [Configure the API and nginx](/self-hosting/managed-vps/configure-the-api-and-nginx) — add
   secrets, persistent paths, the background process and the same-origin proxy.
4. [Deploy and upgrade safely](/self-hosting/managed-vps/deploy-and-upgrade-safely) — stop,
   activate and start one API version at a time, with backups and rollback points.
5. [Finish and operate the installation](/self-hosting/managed-vps/finish-and-operate-the-installation)
   — hand over to the [Owner](/owner/), move to the final domain, add
   [company login](/company-login/) and monitor the instance.

## Worksheet

The long-form pages use these values. Replace every placeholder in them from this private
worksheet. Do not store secret values in it.

| Value | Example | Your value |
| --- | --- | --- |
| Source project | `YOUR-ACCOUNT/capacitylens-hosted` | |
| Production branch | `production-01` | |
| Release tag and commit | `vX.Y.Z` and its full commit | |
| Site user | `capacity-example` | |
| Site directory | `/home/capacity-example/capacity.example.com` | |
| Temporary origin | `https://capacity-example.on-forge.com` | |
| Final origin | `https://capacity.example.com` | |
| API loopback port | `8788` | |
| Supervisor group | `daemon-1234567` | |
| Database path | `/home/capacity-example/data/capacitylens.db` | |
| Backup path | `/home/capacity-example/backups` | |

Keep the session-signing secret, one-time setup token and any company-login credentials in the
platform's secret store or a password manager, not in this worksheet.
