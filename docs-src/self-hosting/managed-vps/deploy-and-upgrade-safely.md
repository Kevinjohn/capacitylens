---
title: Deploy and upgrade safely
description: Promote, deploy and roll back CapacityLens releases without running two API versions against one SQLite database.
---

# Deploy and upgrade safely

This page turns the initial build into a repeatable manual deployment with a safe API handover.
It prevents two CapacityLens versions from writing to the same SQLite database. Allow about thirty
minutes to configure and test the first time; later deployments take only a few minutes plus your
backup and smoke checks.

## Prerequisites

- Complete [Configure the API and nginx](/self-hosting/managed-vps/configure-the-api-and-nginx).
- Record the actual Supervisor group or service name created by the platform.
- Read [Upgrades](/self-hosting/upgrades) and [Backups and restore](/self-hosting/backups-and-restore).
- Confirm automatic deployment remains disabled.

::: warning Do not use overlapping processes
CapacityLens does not support an old API and a new API writing to one database at the same time.
Build while the old API serves traffic, then stop it before activating the release. A brief outage
is expected and safer than a platform's generic zero-downtime handover.
:::

## 1. Save the permanent Forge deployment script

Replace the two values at the top with the isolated site user and exact Supervisor group recorded
from the background process. Save this script only when the platform runs deployment scripts under
Bash, which is Forge's default deployment shell. A runner configured for plain `sh` rejects
`pipefail` before it runs any deployment command.

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

test -f dist/index.html
test -f server/dist/index.mjs

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

Do not replace stop and start with a process-manager reload that overlaps workers. Do not activate
before stopping the old process.

A failure before `supervisorctl stop` leaves the old release serving traffic. A failure after the
stop needs the recovery steps below; the script does not restart the old release automatically.

The first deployment is deliberately different from every later deployment. It activates the
initial build without Supervisor commands. Create the background process from that active release,
record its generated group name, then save the permanent script above. Run one rehearsal deployment
of the same commit before relying on the workflow for an upgrade. The rehearsal must show the API
stop, activation, restart and successful public health check in that order.

Vite may print a warning that `NODE_ENV=production` is not supported inside `.env`. CapacityLens
still needs that value at API runtime, while Vite already makes a production build when `pnpm run
build` runs. The warning is expected for a shared build-and-runtime environment file; it is not a
failed build. Stop for an actual non-zero command exit or a missing build output.

On a platform without Forge's release functions, preserve the same ordering with its checkout,
activation and service-control commands.

## 2. Give the deployment script permission to stop and start the process

The deployment script runs unattended. It cannot answer a password prompt, so the user that runs it
must be able to run `supervisorctl` without one. With website isolation enabled, the isolated site
user usually cannot.

First find out whether you already have permission. Run this as the user the deployment script runs
as:

```bash
sudo -n /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf status
```

`-n` means "never ask for a password". If you will keep `supervisorctl`, next run `sudo -l` and
continue only if it lists exactly the four configuration-pinned commands shown below. A bare
`/usr/bin/supervisorctl` entry is the old, broad grant and must be replaced before you continue. If
you replace both process-control calls with separate platform stop and start actions instead, you
can continue after configuring and testing those actions. If the status command prints `sudo: a
password is required`, choose one of the two fixes below.

### Use the platform's own restart action

Some platforms expose separate stop and start commands or API endpoints for a background process
that do not need `sudo` at all. If yours does, use them in place of the two `supervisorctl` lines in
the script. A single restart action at both boundaries breaks the required stop, activate, start
order. Platform actions are the better option because the platform keeps them working when it
changes how processes are managed.

### Or grant exactly four commands

If there is no platform action, grant the site user permission to run `supervisorctl` and nothing
else. As a user with full `sudo` rights, run:

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

Replace the executable or root-owned configuration path below if either command shows a different
path. Then add these four lines, replacing `capacity-example` with your isolated site user and
`daemon-1234567` with its exact Supervisor group:

```text
capacity-example ALL=(root) NOPASSWD: /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf status
capacity-example ALL=(root) NOPASSWD: /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf stop daemon-1234567\:\*
capacity-example ALL=(root) NOPASSWD: /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf start daemon-1234567\:\*
capacity-example ALL=(root) NOPASSWD: /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf restart daemon-1234567\:\*
```

Save and exit. `visudo` checks the syntax before writing; if it reports an error, fix it there
rather than saving a broken file, because a broken sudoers file can lock everyone out of `sudo`.

Sudoers matches the arguments as one string. The escaped colon and asterisk therefore match the
literal group argument, while an extra process name is denied. The `status` command still lists all
Supervisor processes, but it cannot change them; stop, start and restart are limited to this group.
Other sudoers rules and a Supervisor socket readable by the site user are outside this page.

If you already installed the broad line, edit the same file with `visudo -f` and replace it with the
four lines above. Run `sudo -l -U capacity-example` and confirm no unrestricted `supervisorctl`
entry remains in this or any other sudoers file.

Then re-run the pinned status command as the site user and confirm it works.

## 3. Test the stop and start commands

Before the next real release, stop the API through the exact saved command:

```bash
sudo -n /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf stop 'daemon-1234567:*'
```

Confirm the public health check temporarily fails. Then start it:

```bash
sudo -n /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf start 'daemon-1234567:*'
```

Confirm the process returns to **Running** and the public health endpoint returns `200` with
`"ok":true`.

If either command still requires an interactive password, return to step 2. A deployment must not
pause at an unseen password prompt: the platform will report a timeout long after the API has
already stopped.

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

CapacityLens has no "snapshot now" button. It writes a verified snapshot into
`CAPACITYLENS_BACKUP_DIR` when the API starts, and again every
`CAPACITYLENS_BACKUP_INTERVAL_MIN` minutes. Use one of these:

**Restart the API.** A restart begins the asynchronous snapshot attempt. This is the simplest method
and it costs the same few seconds of downtime the deployment will cost anyway:

```bash
sudo -n /usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf restart 'daemon-1234567:*'
```

Wait for the attempt to finish, then confirm the backup directory contains the new verified file
before relying on it.

**Or take the latest scheduled snapshot.** If the newest file is only minutes old and nothing
important has been written since, it is already a valid restore point.

Either way, list the backup directory newest first and read the top line:

```bash
ls -lt /home/capacity-example/backups | head -3
```

Each filename carries its own timestamp — `capacitylens-utc-20260911-140233-118.db` was written at
14:02:33 UTC on 11 September 2026, not in your local time zone. Confirm the newest file is the one
you expect before you go any further.

Then copy that one file off the server. Run this on your own machine, not on the server:

```bash
scp capacity-example@your-server:/home/capacity-example/backups/capacitylens-utc-YYYYMMDD-HHMMSS-sss.db .
```

::: warning Never copy the live database file
Do not `cp` or `scp` `capacitylens.db` itself while the API is running. SQLite keeps recent writes
in a separate `-wal` file beside it, so a copy of the database alone can be missing data or be
internally inconsistent — and you will not find out until the restore fails. Copy a snapshot from
the backup directory, which CapacityLens has already integrity-checked before publishing it, or
stop the API first. [Backups and restore](/self-hosting/backups-and-restore) covers both.
:::

## 5. Advance the production branch

From a trusted checkout, fetch the release:

```bash
git fetch origin --tags
```

Inspect the target tag and confirm it is the release you intend to run:

```bash
git show --no-patch --decorate vX.Y.Z
```

Switch to the installation branch and merge the released tag without rewriting history:

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

If `--ff-only` fails, stop. The private deployment branch contains commits that are not in the
release history. Do not force-push or hide that divergence; inspect it before deploying.

## 6. Deploy manually

Open the managed site and click **Deploy**. Watch the complete log.

A successful deployment must show, in order:

- the expected Node and pinned pnpm versions;
- successful dependency, web and API builds;
- the old API stopping;
- release activation;
- the new API starting; and
- a successful public health check.

Do not treat “release activated” as success if the API failed to start or health failed.

## 7. Smoke-test the release

After health passes:

1. Open the public site in a new browser session.
2. Sign in.
3. Confirm the expected company opens.
4. Read existing scheduling data.
5. Make one safe write and confirm it persists after refresh.
6. Check the process log for restart loops, migration failures or security errors.
7. Confirm a new scheduled backup succeeds.

Keep the previous release and pre-release snapshot until you are satisfied with these checks.

## 8. Roll back correctly

If the new release did not change the database schema, stop the API, activate the previous release,
start the API and verify health.

If the release changed the schema, switching code alone is not a rollback. Follow the complete
[rollback procedure](/self-hosting/upgrades#roll-back): stop the API, restore the matching pre-migration
snapshot without stale `-wal` or `-shm` files, activate the previous release, then start and verify
it.

Do not let the old release start against a database already migrated by the new release.

## Verify the result

Confirm all of the following:

- The saved script runs under Bash and exits on a failed command, failed pipeline or missing build
  output before it stops the old API.
- The permanent deployment script stops before activation and starts after activation.
- The configuration-pinned stop/start commands work without interaction for this Supervisor group.
- `sudo -l` shows no unrestricted `supervisorctl` grant.
- Only one API process exists for this database.
- The public health check gates deployment success.
- The release branch points at the recorded released commit.
- A fresh off-server backup and a rollback release are available.
- Push-to-deploy remains disabled.

## What's next

Continue to [Finish and operate the installation](/self-hosting/managed-vps/finish-and-operate-the-installation).
