# US-INS-01 — Install CapacityLens for one agency

**Area:** Installation · **Persona:** Technical person at a small agency, or a managed host's site owner · **Coverage:** the gate's `release-package-smoke` job (unpacks the release archive, starts it and checks deep health, the web app and the bundled recovery tool), `server/src/cli/init.test.ts`, `server/src/routes/staticWeb.test.ts` and `server/src/boot/productionDefaults.test.ts`; manual for a managed host and a Linux host

**Documentation:** [Install CapacityLens](../../docs-src/getting-started/install.md)

## Goal

Run CapacityLens on a host the agency controls, from one downloaded archive, in five steps: two
values to choose and one command per step.

## Why

A small agency has no operations team. If installing means building from source, choosing between
routes or reading a configuration reference, the person asked to do it gives up or runs a
half-configured service. An install that is five steps long, the same on every host, and refuses to
start while a required value is missing is one a generalist can finish and trust.

## How (end-to-end)

**Precondition:** a Linux host with Node 24 on the system path, and a hostname pointing at it.

1. Download the release archive and unpack it.
2. Pick a folder for the data. The database file is created there on first start.
3. Run `init` with the public address and the database file. It generates the session secret and
   the setup token, and prints the environment file or writes it with `--out`, readable only by
   its owner and never over an existing file.
4. Start the server: as a background process on a managed host, or as the systemd service from the
   archive on a Linux host, with HTTPS in front of it.
5. Open the address. The first-owner screen appears. Enter the setup token from step 3 and create
   the Owner, then the company.

## Acceptance criteria

- ✅ Nothing is built and no Docker is needed: the archive holds the web app, the server and
  everything it needs.
- ✅ With any of the three values empty, the server refuses to start and names the missing one.
- ✅ Once started, `/api/health` reports `"ok":true`, `"db":true`, `"audit":"ok"` and a backup status
  of `"ok"` (`"pending"` for a moment after the first start).
- ✅ The address serves the web app and the API from one origin, so a single proxy line in front of
  it is enough.
- ✅ Sign-in defaults to email and password under production settings without being configured.
- ✅ Only a person who holds the setup token can create the first Owner, and once any user exists,
  that route closes.
- ✅ A managed-host reader completes the steps from the platform's own screens.
- ✅ A lost sole-Owner password is recovered with the tool in the archive, with no source checkout.
