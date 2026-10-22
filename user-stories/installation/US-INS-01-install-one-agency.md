# US-INS-01 — Install CapacityLens for one agency

**Area:** Installation · **Persona:** Technical person at a small agency, or a managed host's site owner · **Coverage:** the gate's `packaged` job (Standalone native package; unpacks the native release archive, starts the Adonis service and checks health and the web app), `apps/backend/tests/unit/upgrade_command.spec.ts`, `apps/backend/tests/functional/state/static_fallback.spec.ts` and `apps/backend/tests/unit/native_auth_configuration.spec.ts`; manual for a managed host and a Linux host

**Documentation:** [Install CapacityLens](../../docs-src/self-hosting/install.md)

## Goal

Run CapacityLens on a host the agency controls, from one downloaded archive, with private
configuration, a checked database and an HTTPS address.

## Why

A small agency has no operations team. The person installing the service needs a documented
archive-based procedure that names the required settings and checks the database before anyone
uses it.

## How (end-to-end)

**Precondition:** a Linux host with Node 24 on the system path, and a hostname pointing at it.

1. Download the archive for the host's operating system and architecture, verify its checksum,
   and unpack it.
2. Create a dedicated service user and persistent database and backup directories outside the
   release folder.
3. Copy the example environment file to a private location. Run `node ace.js generate:key --show`
   from `backend/` for `APP_KEY`; set the public HTTPS origins, database path and independent
   random `CAPACITYLENS_SECRET` and `CAPACITYLENS_SETUP_TOKEN` values as the installation guide
   describes. Keep open access disabled.
4. Load that environment and run `node ace.js app:upgrade` as the service user from `backend/`.
   This creates a fresh database or checks and upgrades an existing one. Start the service with
   the same environment and an HTTPS reverse proxy, then check `/health/ready`.
5. Open the address, enter the setup token and create the first identity and company. Remove the
   setup token from the environment and restart the service after setup.

## Acceptance criteria

- ✅ Nothing is built and no Docker is needed: the archive holds the web app, the server and
  everything it needs.
- ✅ Missing or invalid required configuration refuses startup and names the setting to correct.
- ✅ Once started, `/health/live` reports `"ok":true` and `/health/ready` checks the database and
  its schema integrity. Backup success is checked independently in logs and completed snapshots.
- ✅ When configured, online snapshots run at startup and every 24 hours. Retention keeps the
  configured number of completed managed snapshots, excluding upgrade snapshots and unrelated files.
  A snapshot taken during normal use restores the expected data on an isolated database path.
- ✅ The address serves the web app and the API from one origin, so a single proxy line in front of
  it is enough.
- ✅ Sign-in defaults to email and password under production settings without being configured.
- ✅ Only a person who holds the setup token can create the first Owner, and once any user exists,
  that route closes.
- ✅ A managed-host reader completes the steps from the platform's own screens.
- ✅ A lost sole-Owner password is recovered with the tool in the archive, with no source checkout.
