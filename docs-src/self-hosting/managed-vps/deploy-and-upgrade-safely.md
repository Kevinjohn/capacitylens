---
title: Deploy and upgrade safely
description: Promote, deploy and roll back CapacityLens releases without running two API versions against one SQLite database.
---

# Deploy and upgrade safely

This page turns the initial build into a repeatable manual deployment with a safe API handover.
It prevents two CapacityLens versions from writing to the same SQLite database. Allow about twenty
minutes to configure and test the first time; later deployments take only a few minutes plus your
backup and smoke checks.

## Prerequisites

- Complete [Configure the API and nginx](configure-the-api-and-nginx.md).
- Record the actual Supervisor group or service name created by the platform.
- Read [Upgrades](../upgrades.md) and [Backups and restore](../backups-and-restore.md).
- Confirm automatic deployment remains disabled.

::: warning Do not use overlapping processes
CapacityLens does not support an old API and a new API writing to one database at the same time.
Build while the old API serves traffic, then stop it before activating the release. A brief outage
is expected and safer than a platform's generic zero-downtime handover.
:::

## 1. Save the permanent Forge deployment script

Replace the two values at the top with the isolated site user and exact Supervisor group recorded
from the background process.

```bash
$CREATE_RELEASE()

cd "$FORGE_RELEASE_DIRECTORY"

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

install -d -m 700 "/home/$SITE_USER/data"
install -d -m 700 "/home/$SITE_USER/backups"

sudo -n supervisorctl stop "${SUPERVISOR_GROUP}:*"

$ACTIVATE_RELEASE()

sudo -n supervisorctl start "${SUPERVISOR_GROUP}:*"
```

The order is load-bearing:

1. Create and build the new release while the old API still runs.
2. Stop the old API and let it drain.
3. Activate the new release by changing `current`.
4. Start the API from the stable `current` working directory.
5. Let the platform check the public health URL.

Do not replace stop and start with a process-manager reload that overlaps workers. Do not activate
before stopping the old process.

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

## 2. Test the stop and start commands

Before the next real release, stop the API through the exact saved command:

```bash
sudo -n supervisorctl stop 'daemon-1234567:*'
```

Confirm the public health check temporarily fails. Then start it:

```bash
sudo -n supervisorctl start 'daemon-1234567:*'
```

Confirm the process returns to **Running** and the public health endpoint returns `200` with
`"ok":true`.

If either command requires an interactive password, configure the platform's supported service
restart mechanism instead. A deployment must not pause at an unseen password prompt.

## 3. Prepare every release

Before advancing the production branch:

1. Read the target release notes and `CHANGELOG.md`.
2. Check for schema changes or operator actions.
3. Confirm the current public health check is operational.
4. Confirm the latest scheduled backup is fresh.
5. Take a fresh explicit SQLite snapshot using CapacityLens's backup procedure.
6. Copy that snapshot off the server.
7. Confirm a recent restore test exists.
8. Record the currently deployed tag and commit for rollback.

Never copy a live SQLite database file with `cp`. Use CapacityLens's SQLite backup mechanism or
stop the API first, as described in [Backups and restore](../backups-and-restore.md).

## 4. Advance the production branch

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

## 5. Deploy manually

Open the managed site and click **Deploy**. Watch the complete log.

A successful deployment must show, in order:

- the expected Node and pinned pnpm versions;
- successful dependency, web and API builds;
- the old API stopping;
- release activation;
- the new API starting; and
- a successful public health check.

Do not treat “release activated” as success if the API failed to start or health failed.

## 6. Smoke-test the release

After health passes:

1. Open the public site in a new browser session.
2. Sign in.
3. Confirm the expected company opens.
4. Read existing scheduling data.
5. Make one safe write and confirm it persists after refresh.
6. Check the process log for restart loops, migration failures or security errors.
7. Confirm a new scheduled backup succeeds.

Keep the previous release and pre-release snapshot until you are satisfied with these checks.

## 7. Roll back correctly

If the new release did not change the database schema, stop the API, activate the previous release,
start the API and verify health.

If the release changed the schema, switching code alone is not a rollback. Follow the complete
[rollback procedure](../upgrades.md#roll-back): stop the API, restore the matching pre-migration
snapshot without stale `-wal` or `-shm` files, activate the previous release, then start and verify
it.

Do not let the old release start against a database already migrated by the new release.

## Verify the result

Confirm all of the following:

- The permanent deployment script stops before activation and starts after activation.
- The stop/start commands work without interaction.
- Only one API process exists for this database.
- The public health check gates deployment success.
- The release branch points at the recorded released commit.
- A fresh off-server backup and a rollback release are available.
- Push-to-deploy remains disabled.

## What's next

Continue to [Finish and operate the installation](finish-and-operate-the-installation.md).
