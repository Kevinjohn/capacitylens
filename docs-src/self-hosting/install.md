---
title: Install CapacityLens
description: Install CapacityLens from a release archive in five steps, on a managed host or a Linux host, with three values to fill in.
---

# Install CapacityLens

Five steps, three values to fill in, one command per step. Each step notes where a managed host
and a Linux host differ. On a host that already runs Node 24 and has a hostname pointing at it,
it takes about ten minutes; an internet-facing instance takes longer, mostly because of DNS and
certificates.

## You need

- Node 24.19.0 or newer within 24.x on the host's system path. Check with `node --version`.
- A hostname that points at the host, with HTTPS in front. A managed host issues the certificate;
  on your own host, [Caddy](/self-hosting/install-without-docker#https) does it in four lines.
- Linux. The archive is tested on Ubuntu x86-64; other Linux distributions and macOS are expected
  to work but are not tested.
- Persistent storage for the database, the audit log and the scheduled backups that production
  writes by default.

Node 26.9.0 or newer within 26.x is experimental, best-effort and not guaranteed to be fully
functional. Use current patches within either line. See
[the compatibility policy](/reference/development#check-node-26-compatibility).

Want a look first? [Try the demo](/getting-started/try-the-demo) instead.

## 1. Download

Download the release archive and unpack it. It holds the built web app and the server, so there
is nothing to build and no Docker. The release also lists a `.sha256` file to check it against.

```text
https://github.com/Kevinjohn/capacitylens/releases/download/v0.73.0-alpha.1/capacitylens-0.73.0-alpha.1.tar.gz
```

0.73.0-alpha.1 is the first release with an archive; for an earlier one, use
[Docker](/self-hosting/install-with-docker). For a newer release, use its version in place of
0.73.0-alpha.1.

- **Managed host:** put the data-folder, download, unpack and link commands in the site's deploy
  script. Its first line creates the data folder from step 2, so no terminal is needed.
- **Linux host:** unpack it into `/opt/capacitylens` and link `current` to the release folder.

## 2. Pick a folder for the data

The database file is created here on first start. Keep it outside the unpacked release, so an
upgrade never touches it.

- **Managed host:** `/home/forge/capacitylens-data`, next to the site folder. The deploy script
  creates it. `forge` is the site's user; a site with website isolation uses its own user, so
  use that name in this path and in `CAPACITYLENS_DB`.
- **Linux host:** `/var/lib/capacitylens`, owned by a `capacitylens` user.

## 3. Configure

Run `init` from the unpacked release folder, with the address people open and a database file
in the data folder:

```bash
node server/dist/index.mjs init --public-url https://capacity.example.com --db /var/lib/capacitylens/capacitylens.db
```

It prints the environment file, with the session secret and setup token generated. Everything
else has a default.

```dotenv
NODE_ENV=production
CAPACITYLENS_PUBLIC_URL=https://capacity.example.com
CAPACITYLENS_SECRET=<generated>
CAPACITYLENS_SETUP_TOKEN=<generated>
CAPACITYLENS_DB=/var/lib/capacitylens/capacitylens.db
```

It then prints the setup token again; it is entered once, to create the Owner. The server refuses
to start while a required line is empty, and names the missing one.

- **Managed host:** run it with `--db /home/forge/capacitylens-data/capacitylens.db` (or your site
  user's folder) and paste the output into the site's environment editor.
- **Linux host:** add `--out /etc/capacitylens.env` and run it with `sudo`. It writes the file
  readable only by root, and refuses to overwrite an existing one.

## 4. Start it

- **Managed host:** add a background process (daemon) that runs as the site's user and runs
  `node --env-file=../.env server/dist/index.mjs` in the site's `current` folder. In the site's
  nginx file, replace the generated `location /` block with the locations on
  [Deploy on a managed host](/self-hosting/managed-vps/#the-five-steps), which proxy to port 8787.
- **Linux host:** install the `capacitylens.service` file from the archive as a systemd service,
  and put Caddy or nginx in front.

The server serves the web app as well as the API, so one reverse-proxy line covers the whole
site. [TLS and networking](/self-hosting/tls-and-networking) has the proxy requirements.

## 5. Open the address

Open the address from step 3 and check the first-Owner screen loads. It asks for the setup token:
the `CAPACITYLENS_SETUP_TOKEN` line from step 3.

If you are also the Owner, continue with [Set up your company](/owner/). Otherwise, send the
address to the Owner, and send the setup token separately and privately.

## Choose your host

- [Deploy on a managed host](/self-hosting/managed-vps/) such as Forge, Ploi or
  RunCloud, in the platform's screens.
- [Install without Docker](/self-hosting/install-without-docker) on a Linux host you manage,
  with Caddy for HTTPS.

Both end with [TLS and networking](/self-hosting/tls-and-networking) and
[Verify and hand over](/self-hosting/verify-and-hand-over).
[Configuration](/self-hosting/configuration) covers every other setting.

## Other ways to install

- [Install with Docker](/self-hosting/install-with-docker) builds and runs the Compose stack from
  a checkout, if your host already runs Docker.
- To run your own changes, build from a clone with the [development guide](/reference/development).
