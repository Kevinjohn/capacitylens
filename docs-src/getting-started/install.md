---
title: Install CapacityLens
description: Install CapacityLens from a release archive in five steps, on a managed host or a Linux host, with three values to fill in.
---

# Install CapacityLens

Every host takes the same five steps: three values to fill in and one command per step. Only
step 4, starting the server, differs between hosts. The target is ten minutes on a host that
already has Node 24 and a hostname pointing at it.

The steps use the release archive, `capacitylens-0.73.0-alpha.1.tar.gz`. It holds the built web
app, the server and everything it needs to run, so there is nothing to build and no Docker.
0.73.0-alpha.1 is the first release that carries it; for an earlier release, use
[Docker](/self-hosting/install-with-docker). For a newer release, use its version in place of
0.73.0-alpha.1 below.

::: tip
Just want to look around first? [Try the demo](/getting-started/try-the-demo) instead —
no persistent data or sign-in setup required.
:::

## You need

- Node 24 on the host's system path. Check with `node --version`.
- A hostname that points at the host, with HTTPS in front of CapacityLens. A managed host issues
  the certificate for you; on your own host, [Caddy](/self-hosting/install-without-docker#https)
  does it in four lines.
- Linux. The archive is tested on Ubuntu x86-64; other Linux distributions and macOS are expected
  to work but are not tested.

## 1. Download

Download the archive from the release's assets and unpack it. The release also lists a `.sha256`
file to check the download against.

```text
https://github.com/Kevinjohn/capacitylens/releases/download/v0.73.0-alpha.1/capacitylens-0.73.0-alpha.1.tar.gz
```

- **Managed host:** put the download, unpack and link commands in the site's deploy script.
- **Linux host:** unpack it into `/opt/capacitylens` and link `current` to the release folder.

## 2. Pick a folder for the data

The database file is created in this folder on first start. Keep it outside the unpacked release,
so an upgrade never touches it.

- **Managed host:** `/home/forge/capacitylens-data`, next to the site folder.
- **Linux host:** `/var/lib/capacitylens`, owned by a `capacitylens` user.

## 3. Configure

Copy `capacitylens.env.example` from the archive and fill in its three empty lines. Everything
else has a default.

```dotenv
NODE_ENV=production
SMALLSASS_ACCOUNT_PUBLIC_URL=
SMALLSASS_ACCOUNT_SECRET=
SMALLSASS_ACCOUNT_SETUP_TOKEN=
CAPACITYLENS_DB=/var/lib/capacitylens/capacitylens.db
```

- `SMALLSASS_ACCOUNT_PUBLIC_URL` is the address people open, for example
  `https://capacity.example.com`.
- `SMALLSASS_ACCOUNT_SECRET` and `SMALLSASS_ACCOUNT_SETUP_TOKEN` are two different values, each
  pasted from `openssl rand -base64 48`. You enter the setup token once, to create the Owner.

The server refuses to start while any of the three is empty, and names the one that is missing.

- **Managed host:** paste the lines into the site's environment editor.
- **Linux host:** save them as `/etc/capacitylens.env`.

## 4. Start it

This is the step that differs.

- **Managed host:** add a background process (daemon) that runs
  `node --env-file=../.env server/dist/index.mjs` in the site's `current` folder, and point
  the site's nginx at port 8787.
- **Linux host:** install the `capacitylens.service` file from the archive as a systemd service,
  and put Caddy or nginx in front.

The server serves the web app as well as the API, so one reverse-proxy line in front of it covers
the whole site.

## 5. Open the address

Open the address from step 3 and create your company. The page asks for the setup token: it is
the `SMALLSASS_ACCOUNT_SETUP_TOKEN` line from step 3. From there, the
[Owner guide](/owner/) takes over.

## Choose your host

- [Deploy on a managed VPS platform](/self-hosting/managed-vps/) such as Forge, Ploi or
  RunCloud. You work in the platform's screens; no terminal is needed.
- [Install without Docker](/self-hosting/install-without-docker) on a Linux host that you manage
  yourself. Each step is one command, and Caddy handles HTTPS.

Both end with the same checks. Then [secure the connection](/installation/secure-the-connection)
and [verify and hand over](/installation/verify-and-hand-over); [configure the
service](/installation/configure-the-service) covers every other setting.

## Other ways to install

- [Install with Docker](/self-hosting/install-with-docker) builds and runs the packaged Compose
  stack from a checkout. Use it if your host already runs Docker.
- Building from source is for a release that predates the archive, or for your own changes. The
  [long-form managed host pages](/self-hosting/managed-vps/choose-the-release-source) build
  from a tagged checkout, and the [development guide](/reference/development) covers running it
  from a clone.
