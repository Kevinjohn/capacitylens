---
title: Create and build the managed site
description: Configure the site, release directories, Node toolchain and production build on a managed VPS platform.
---

# Create and build the managed site

This page creates the managed site and produces both CapacityLens build outputs without starting
the API yet. It uses a release-local Corepack shim so every build uses the pnpm version pinned by
CapacityLens. Allow about fifteen minutes for the first dependency install and build.

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

Website isolation gives the site its own operating-system user. Use it when several installations
share a server. It does not replace separate servers when strong isolation is required.

## 2. Use a temporary domain when necessary

If the final DNS record is not ready, use the platform's temporary HTTPS domain. It is safe to add
the final domain later.

Record the temporary origin exactly, including `https://`. You will use it as
`SMALLSASS_ACCOUNT_PUBLIC_URL` until the domain cutover.

Do not configure company login against the temporary origin unless you are prepared to replace
its redirect URI later.

## 3. Set the application directories

Use these values:

```text
Root directory: /
Web or public directory: /dist
```

The repository root contains the workspace and the frontend build. `pnpm run build` writes the
static web app to `dist/`. The API build is a separate file at `server/dist/index.mjs`.

Leave shared-path controls empty. The database, audit log and backups will use absolute paths
outside the release tree instead.

## 4. Check Node and Corepack

Run these commands through the platform's command runner or a shell as the isolated site user:

```bash
node --version
```

The version must be 24 or newer.

```bash
corepack --version
```

The command must print a version rather than `command not found`.

Do not install an arbitrary global pnpm version. CapacityLens pins pnpm in `package.json` and
checks it during dependency lifecycle scripts.

## 5. Install with a release-local pnpm shim

Managed platforms often provide their own global pnpm. Calling `corepack pnpm` for only the first
command is not sufficient: nested lifecycle scripts may find the platform's global binary and fail
the version check.

Add this build section to the deployment script:

```bash
$CREATE_RELEASE()

cd "$FORGE_RELEASE_DIRECTORY"

mkdir -p "$FORGE_RELEASE_DIRECTORY/.corepack"
corepack enable --install-directory "$FORGE_RELEASE_DIRECTORY/.corepack"
export PATH="$FORGE_RELEASE_DIRECTORY/.corepack:$PATH"

node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm run build
pnpm --filter capacitylens-server run build:runtime
```

`$FORGE_RELEASE_DIRECTORY` is Laravel Forge's new release path. On another platform, replace it
with that platform's new-release variable or run the same commands from the checkout directory.

Expected build outputs:

```text
dist/index.html
server/dist/index.mjs
```

The pnpm version must match the `packageManager` value in `package.json`. Stop if it does not.

## 6. Create the persistent directories

Add these commands after the build, replacing `capacity-example` with the isolated site user:

```bash
SITE_USER="capacity-example"
install -d -m 700 "/home/$SITE_USER/data"
install -d -m 700 "/home/$SITE_USER/backups"
```

Run the deployment as that site user. Confirm the directories are owned by the same user that will
run the API.

Never put the database under the release directory, `current/`, `dist/` or `server/dist/`.
Platforms routinely delete old releases.

## 7. Run the first build

For the first deployment only, let the platform create and activate the release after the build.
Do not add Supervisor stop/start commands yet because the background process does not exist.

This order is required on a new site:

1. Save the temporary deployment script.
2. Run the first deployment and confirm both build outputs exist.
3. Create the background process on the next page.
4. Record the process manager's generated service or group name.
5. Replace the temporary script with the permanent stop, activate and start sequence.

Do not invent a Supervisor group name before Forge creates the process. Forge assigns the name,
and the permanent deployment script must use that exact value.

In Laravel Forge, the temporary script can end with:

```bash
$ACTIVATE_RELEASE()
```

Click **Deploy** and watch the complete output. Do not treat an activated release as a successful
installation until both build outputs exist and the deployment exits successfully.

## Verify the result

Run these checks from the active release:

```bash
test -f dist/index.html
```

```bash
test -f server/dist/index.mjs
```

Then confirm:

- the site uses an isolated user;
- nginx's web directory ends in `/dist`;
- the active release used Node 24 or newer;
- the active release used the pinned pnpm version; and
- `data/` and `backups/` exist outside the release tree with mode `700`.

The public site may still show an error because the API and proxy are configured on the next page.

## What's next

Continue to [Configure the API and nginx](/self-hosting/managed-vps/configure-the-api-and-nginx).
