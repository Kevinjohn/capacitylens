---
title: Create and build the managed site
description: Configure the site, release directories, Node toolchain and production build on a managed VPS platform.
---

# Create and build the managed site

Long-form route: building from a source checkout. To install from the release archive with
nothing to build, follow the [five steps](/self-hosting/managed-vps/) instead.

Create the site and produce both build outputs, without starting the API yet. A release-local
Corepack shim makes every build use CapacityLens's pinned pnpm. Allow about fifteen minutes for
the first dependency install and build.

## Prerequisites

- Complete [Choose the release source](/self-hosting/managed-vps/choose-the-release-source).
- Choose a unique site name and a unique API loopback port.
- Confirm the server has Node 24 or newer and Corepack.

## 1. Create a custom site

Create an **Other**, **Custom application** or equivalent site. Do not select Laravel, Symfony,
WordPress or another framework template.

In Laravel Forge:

1. Open the server.
2. Select **New site**.
3. Select **Other**.
4. Enter the platform domain or custom domain.
5. Select the source-control provider, project and pinned production branch.
6. Enable **Website isolation**.

Website isolation gives the site its own operating-system user, for when several installations
share a server. It does not replace separate servers when strong isolation is required.

## 2. Use a temporary domain when necessary

If the final DNS record is not ready, use the platform's temporary HTTPS domain and add the final
domain later. Record the temporary origin exactly, including `https://`: it is
`CAPACITYLENS_PUBLIC_URL` until the domain cutover. Don't configure company login against it
unless you are prepared to replace its redirect URI later.

## 3. Set the application directories

Use these values:

```text
Root directory: /
Web or public directory: /production/dist
```

`pnpm run build` writes the static web app to the temporary `dist/` directory.
`pnpm run package:managed-release` then copies it into `production/dist/` and packages the API at
`production/server/dist/index.mjs` with production dependencies only.

Leave shared-path controls empty. The database, audit log and backups use absolute paths outside
the release tree.

## 4. Check Node and Corepack

Run these through the platform's command runner, or a shell as the isolated site user:

```bash
node --version
```

It must be 24 or newer.

```bash
corepack --version
```

It must print a version, not `command not found`. Don't install a global pnpm: CapacityLens pins
pnpm in `package.json` and checks it during dependency lifecycle scripts.

## 5. Install with a release-local pnpm shim

Platforms often provide their own global pnpm, and nested lifecycle scripts can find it and fail
the version check even if the first command uses `corepack pnpm`. Add this build section to the
deployment script. It needs Bash, Forge's default deployment shell: `set -eo pipefail` is a syntax
error under plain `sh`.

```bash
set -eo pipefail

$CREATE_RELEASE()

cd "${FORGE_RELEASE_DIRECTORY:?}"

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

# Build dependencies are no longer needed after the portable runtime is complete.
rm -rf .corepack node_modules shared/node_modules server/node_modules
```

`$FORGE_RELEASE_DIRECTORY` is Forge's new release path. On another platform, use its
new-release variable or run the commands from the checkout directory. The activated artifact is:

```text
production/dist/index.html
production/server/dist/index.mjs
production/server/dist/importWorker.mjs
production/server/node_modules/
```

Stop if the pnpm version does not match `packageManager` in `package.json`.

## 6. Create the persistent directories

Add these commands after the build, replacing `capacity-example` with the isolated site user:

```bash
SITE_USER="capacity-example"
install -d -m 700 "/home/$SITE_USER/data"
install -d -m 700 "/home/$SITE_USER/backups"
```

Run the deployment as that site user, so the directories belong to the user that runs the API.
Never put the database under the release directory, `current/`, `production/dist/` or
`production/server/dist/`: platforms routinely delete old releases.

## 7. Run the first build

For the first deployment only, let the platform activate the release after the build. Don't add
Supervisor stop/start commands yet; the background process does not exist. On a new site, in
this order:

1. Save the temporary deployment script.
2. Run the first deployment and confirm both build outputs exist.
3. Create the background process on the next page.
4. Record the process manager's generated service or group name.
5. Replace the temporary script with the permanent stop, activate and start sequence.

Forge assigns the Supervisor group name when it creates the process; the permanent script must use
that exact value. In Forge, the temporary script can end with:

```bash
$ACTIVATE_RELEASE()
```

Click **Deploy** and watch the complete output. It has succeeded only when both build outputs
exist and the deployment exits successfully.

## Verify the result

Run these checks from the active release:

```bash
test -f production/dist/index.html
```

```bash
test -f production/server/dist/index.mjs
```

Then confirm:

- the site uses an isolated user;
- nginx's web directory ends in `/production/dist`;
- the active release used Node 24 or newer;
- the active release used the pinned pnpm version; and
- `data/` and `backups/` exist outside the release tree with mode `700`.

The public site may still show an error until the next page configures the API and proxy.

Next: [Configure the API and nginx](/self-hosting/managed-vps/configure-the-api-and-nginx).
