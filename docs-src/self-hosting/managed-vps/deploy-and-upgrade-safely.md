---
title: Deploy and upgrade safely
description: Promote, deploy and roll back CapacityLens releases without running two API versions against one SQLite database.
---

# Deploy and upgrade safely

Long-form route: building from a source checkout. To install from the release archive with
nothing to build, follow the [five steps](/self-hosting/managed-vps/) instead.

Turn the initial build into a repeatable manual deployment that never lets two CapacityLens
versions write to the same database. Allow about thirty minutes the first time; later deployments
take a few minutes plus your backup and smoke checks.

## Prerequisites

- Complete [Configure the API and nginx](/self-hosting/managed-vps/configure-the-api-and-nginx).
- Record the actual Supervisor group or service name created by the platform.
- Read [Upgrades](/self-hosting/upgrades) and [Backups and restore](/self-hosting/backups-and-restore).
- Confirm automatic deployment remains disabled.

::: warning Do not use overlapping processes
An old and a new API must never write to one database at the same time. Build while the old API
serves traffic, then stop it before activating the release. The brief outage is expected, and
safer than a platform's zero-downtime handover.
:::

## 1. Save the permanent Forge deployment script

Replace the two values at the top with the isolated site user and the exact Supervisor group. The
script needs Bash, Forge's default deployment shell: `set -eo pipefail` is a syntax error under
plain `sh`.

```bash
set -eo pipefail

$CREATE_RELEASE()

cd "${FORGE_RELEASE_DIRECTORY:?}"

SITE_USER="capacity-example"
SUPERVISOR_GROUP="daemon-1234567"

mkdir -p "$FORGE_RELEASE_DIRECTORY/.corepack"
corepack enable --install-directory "$FORGE_RELEASE_DIRECTORY/.corepack"
export PATH="$FORGE_RELEASE_DIRECTORY/.corepack:$PATH"

node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm run build
pnpm --filter capacitylens-server run build:runtime
pnpm run package:managed-release

test -f production/dist/index.html
test -f production/server/dist/index.mjs
test -f production/server/dist/importWorker.mjs

rm -rf .corepack node_modules shared/node_modules server/node_modules

install -d -m 700 "/home/$SITE_USER/data"
install -d -m 700 "/home/$SITE_USER/backups"

sudo -n /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf stop "${SUPERVISOR_GROUP}:*"

$ACTIVATE_RELEASE()

sudo -n /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf start "${SUPERVISOR_GROUP}:*"
```

The order is load-bearing:

1. Create and build the new release while the old API still runs.
2. Stop the old API and let it drain.
3. Activate the new release by changing `current`.
4. Start the API from the stable `current` working directory.
5. Let the platform check the public health URL.

Don't replace stop and start with a reload that overlaps workers, and don't activate before
stopping. A failure before `supervisorctl stop` leaves the old release serving traffic; a failure
after it needs the recovery steps below, because the script does not restart the old release.

### First transition to the production artifact paths

Older releases use `/dist` as the web directory and start `server/dist/index.mjs`. Don't change
either saved path while such a release is active, or nginx and Supervisor point at missing files.
Treat the first release containing `production/` as a maintenance-window cutover:

1. Build the new release and confirm all three `production/` files checked by the script exist.
2. Keep the old release active while you record its `/dist` web directory and
   `server/dist/index.mjs` process command as the rollback values.
3. Stop the old API. While it is stopped, change the saved process command to
   `production/server/dist/index.mjs` and the site's web directory to `/production/dist`.
4. Activate the new release, reload the platform's nginx configuration if it does not do so
   automatically, then start the API and complete the health and smoke checks.

If that first cutover fails and the database schema is still compatible, stop the API, restore the
old `/dist` and `server/dist/index.mjs` settings, reactivate the old release, reload nginx and start
the old API. For a schema-bearing release, restore its pre-release database snapshot as described
under rollback below before starting old code. Once every retained rollback release contains
`production/`, the ordinary deployment script can keep both saved paths unchanged.

The first deployment activates the initial build without Supervisor commands. Create the
background process from that release, record its group name, then save the permanent script.
Before relying on it for an upgrade, rehearse a deployment of the same commit: it must show the
API stop, activation, start and a successful public health check, in that order.

Keep `NODE_ENV=production` on the API process rather than in the shared `.env` file. Vite reads
`.env` while building the browser app, and `pnpm run build` already selects production mode. The
managed process command sets `NODE_ENV=production` directly. Stop for an actual non-zero command
exit or a missing build output.

On a platform without Forge's release functions, keep the same order with its checkout,
activation and service-control commands.

### Keep operator tooling in a separate maintenance checkout

The activated release has no pnpm, `tsx` or development dependencies, so recovery, cutover and
rehearsal commands run from a separate private maintenance checkout, never from `current/`:

1. Select the revision required by the operation. Recovery and repair commands use the exact tag or
   commit currently serving production. A pre-upgrade migration rehearsal uses the intended target
   release instead, because it must prove that target's migrations before deployment. Check out the
   selected revision in a protected directory outside every release directory.
2. Enable the pinned pnpm version there and run `pnpm install --frozen-lockfile`.
3. Stop the API before any documented command that writes to the database. Pass the persistent
   database, backup and evidence paths as absolute paths; do not copy them into the checkout.
4. Run the documented `pnpm --filter capacitylens-server ...` command, complete its verification,
   then restart and smoke-test the API.
5. Remove the maintenance checkout and its dependency tree when the operation and evidence capture
   are complete. Never point nginx or Supervisor at it.

[When something goes wrong](/self-hosting/incidents) has the command-specific safeguards. The
maintenance checkout must never start a second API against the production database.

## 2. Give the deployment script permission to stop and start the process

The script runs unattended, so its user must run `supervisorctl` without a password prompt. With
website isolation, the site user usually cannot. Check, as the user the script runs as:

```bash
sudo -n /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf status
```

`-n` means "never ask for a password". If you keep `supervisorctl`, run `sudo -l` and continue
only if it lists exactly four commands, `status`, `stop`, `start` and `restart`, each pinned to
this Supervisor configuration path, with `stop`, `start` and `restart` also pinned to this group.
A bare `/usr/bin/supervisorctl` entry is the old, broad grant: replace it first. If the status
command prints `sudo: a password is required`, choose one of the two fixes below.

### Use the platform's separate stop and start actions

If your platform has separate stop and start commands or API endpoints that need no `sudo`, use
them in place of the two `supervisorctl` lines, and test them. This is the better option: the
platform keeps them working when it changes how processes are managed. A single restart action at
both points breaks the stop, activate, start order.

### Or grant exactly four commands

Otherwise, grant the site user `supervisorctl` and nothing else. As a user with full `sudo`
rights, run:

```bash
sudo visudo -f /etc/sudoers.d/capacitylens-supervisor
```

Confirm both absolute paths before you save the rule:

```bash
which supervisorctl
```

```bash
ls -l /etc/supervisor/supervisord.conf
```

If either prints a different path, use it below. Add these four lines, replacing
`capacity-example` with your site user and `daemon-1234567` with its exact Supervisor group:

```text
capacity-example ALL=(root) NOPASSWD: /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf status
capacity-example ALL=(root) NOPASSWD: /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf stop daemon-1234567\:\*
capacity-example ALL=(root) NOPASSWD: /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf start daemon-1234567\:\*
capacity-example ALL=(root) NOPASSWD: /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf restart daemon-1234567\:\*
```

Save and exit. If `visudo` reports a syntax error, fix it there: a broken sudoers file can lock
everyone out of `sudo`.

Sudoers matches the arguments as one string, so the escaped colon and asterisk match the literal
group argument and an extra process name is denied. `status` lists all Supervisor processes but
cannot change them. Other sudoers rules, and a Supervisor socket the site user can read, are
outside this rule set.

If you installed the broad line, replace it in the same file with `visudo -f`. Run
`sudo -l -U capacity-example` and confirm no unrestricted `supervisorctl` entry remains in any
sudoers file. Then re-run the pinned status command as the site user.

## 3. Test the stop and start commands

Before the next real release, stop the API with the exact saved command:

```bash
sudo -n /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf stop 'daemon-1234567:*'
```

Confirm the public health check temporarily fails. Then start it:

```bash
sudo -n /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf start 'daemon-1234567:*'
```

Confirm the process returns to **Running** and the public health endpoint returns `200` with
`"ok":true`.

If either still asks for a password, return to step 2. Otherwise a deployment pauses at an
unseen prompt and times out long after the API has stopped.

## 4. Prepare every release

Before advancing the production branch:

1. Read the target release notes and `CHANGELOG.md`.
2. Check for schema changes or operator actions.
3. Confirm the current public health check is operational.
4. Confirm the latest scheduled backup is fresh.
5. Take a fresh snapshot, using one of the two methods below.
6. Copy that snapshot off the server.
7. Confirm a recent restore test exists.
8. Record the currently deployed tag and commit for rollback.

### Take a fresh snapshot

There is no "snapshot now" button. CapacityLens writes a verified snapshot into
`CAPACITYLENS_BACKUP_DIR` when the API starts, and every `CAPACITYLENS_BACKUP_INTERVAL_MIN`
minutes after that.

**Restart the API.** The simplest method, costing the same few seconds of downtime as the
deployment:

```bash
sudo -n /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf restart 'daemon-1234567:*'
```

Wait for the snapshot to finish and confirm the new verified file is in the backup directory.

**Or use the latest scheduled snapshot**, if it is only minutes old and nothing important has been
written since.

Either way, list the backup directory newest first:

```bash
ls -lt /home/capacity-example/backups | head -3
```

Filenames carry a UTC timestamp: `capacitylens-utc-20260911-140233-118.db` was written at
14:02:33 UTC on 11 September 2026. Confirm the newest file is the one you expect, then copy it off
the server. Run this on your own machine:

```bash
scp capacity-example@your-server:/home/capacity-example/backups/capacitylens-utc-YYYYMMDD-HHMMSS-sss.db .
```

::: warning Never copy the live database file
Do not `cp` or `scp` `capacitylens.db` while the API is running. SQLite keeps recent writes in a
separate `-wal` file, so the copy can be missing data or inconsistent, and you won't find out until
the restore fails. Copy an integrity-checked snapshot from the backup directory, or stop the API
first. [Backups and restore](/self-hosting/backups-and-restore) covers both.
:::

## 5. Advance the production branch

From a trusted checkout, fetch the release:

```bash
git fetch origin --tags
```

Confirm the target tag is the release you intend to run:

```bash
git show --no-patch --decorate vX.Y.Z
```

Fast-forward the installation branch to the tag:

```bash
git switch production-01
```

```bash
git merge --ff-only vX.Y.Z
```

Push it to the source selected by the platform:

```bash
git push hosted production-01
```

If `--ff-only` fails, stop: the branch has commits outside the release history. Don't force-push;
inspect the divergence before deploying.

## 6. Deploy manually

Open the site, click **Deploy** and watch the complete log. It must show, in order:

- the expected Node and pinned pnpm versions;
- successful dependency, web and API builds;
- the old API stopping;
- release activation;
- the new API starting; and
- a successful public health check.

“Release activated” is not success if the API failed to start or health failed.

## 7. Smoke-test the release

After health passes:

1. Open the public site in a new browser session.
2. Sign in.
3. Confirm the expected company opens.
4. Read existing scheduling data.
5. Make one safe write and confirm it persists after refresh.
6. Check the process log for restart loops, migration failures or security errors.
7. Confirm a new scheduled backup succeeds.

Keep the previous release and pre-release snapshot until these checks pass.

## 8. Roll back correctly

Without a schema change: stop the API, activate the previous release, start it and verify health.

With a schema change, switching code alone is not a rollback, and the old release must never start
against a database the new one has migrated. Follow the
[rollback procedure](/self-hosting/upgrades#roll-back): stop the API, restore the matching
pre-migration snapshot without stale `-wal` or `-shm` files, activate the previous release, then
start and verify it.

## Verify the result

Confirm:

- The saved script runs under Bash and exits on a failed command, failed pipeline or missing build
  output before it stops the old API.
- The permanent deployment script stops before activation and starts after activation.
- The pinned stop/start commands work without interaction for this Supervisor group.
- `sudo -l` shows no unrestricted `supervisorctl` grant.
- Only one API process exists for this database.
- The public health check gates deployment success.
- The release branch points at the recorded released commit.
- A fresh off-server backup and a rollback release are available.
- Push-to-deploy remains disabled.

Next: [Finish and operate the installation](/self-hosting/managed-vps/finish-and-operate-the-installation).
