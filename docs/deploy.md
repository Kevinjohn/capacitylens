# Deploying CapacityLens (Laravel Forge + DigitalOcean)

> **This page documents the legacy static localStorage build, which is now an explicit
> demo opt-in (`VITE_CAPACITYLENS_DEMO=1`).** As of v0.11.0 CapacityLens is **server-backed
> by default** (an empty env = the same-origin SQLite `/api`). For the default server-backed
> deploy see [`docs/self-hosting.md`](self-hosting.md) / [`docs/runbook.md`](runbook.md).
> The DNS/SSL/Nginx basics below still apply to either build.

CapacityLens is a Vite/React SPA in a pnpm-workspaces monorepo. By default it is
**server-backed** — the build talks to the same-origin SQLite `/api` and the `server/`
(Fastify + SQLite) is documented in `server/README.md`. This guide covers the **legacy
static SPA** build, which persists to the browser's `localStorage` and needs no backend;
that build is now an **explicit demo opt-in** via `VITE_CAPACITYLENS_DEMO=1` (`pnpm run
dev:demo`). You don't SSH in to run pnpm by hand — Forge's **Deploy Script** runs `git
pull` + the pnpm build on the droplet for you on each deploy. SSH is only for debugging.

> **For the live controlled demo, follow the server path, not this page.** The demo runs
> in **server mode** (daemon + `/api` proxy + persistent SQLite; per the 2026-06-16 update
> the alpha runs with **no auth gate**). The cutover runsheet is
> [`production-plan.md`](production-plan.md) Phase 2 and day-to-day operations live in
> [`runbook.md`](runbook.md) — follow those, or you'll ship a localStorage-only build.

## 1. DNS

Add an **A record** for the subdomain pointing at the droplet's public IP
(e.g. `capacitylens` → `203.0.113.10`).

## 2. Create the Site in Forge

Forge → server → **New Site**:

- **Root Domain:** `capacitylens.yourdomain.com`
- **Project Type:** `Static HTML`
- **Web Directory:** `/dist`  ← serves the Vite build output, not `/public`.

## 3. Connect the Git repo

Site → **Apps** → **Git Repository**. Select provider, repo, and branch.
Leave "Install Composer Dependencies" unchecked (no PHP).

## 4. Node version

Ensure the Forge server runs **Node 24+** — pinned by the root `.nvmrc` (`24`) and the
`"engines": { "node": ">=24" }` field in every workspace manifest. The optional `server/`
workspace needs Node 24 specifically, where `node:sqlite` is unflagged. pnpm comes via
`corepack enable` (pinned by the root `packageManager` field), no separate install needed.

## 5. Deploy Script

Site → **Apps** → **Deploy Script**:

```bash
cd /home/forge/capacitylens.yourdomain.com

git pull origin $FORGE_SITE_BRANCH

# --frozen-lockfile pins the install to pnpm-lock.yaml (CI-style, no drift).
# pnpm >=9 installs devDependencies regardless of NODE_ENV (add --prod=false to force them explicitly if a droplet config ever sets production=true).
pnpm install --frozen-lockfile

pnpm run build   # paraglide:compile && tsc -b && vite build  ->  dist/
```

If the build still fails with `vite: not found` / `tsc: not found`, ensure devDependencies
are installed by prepending `pnpm install --prod=false` to the script (in case a droplet
config sets `production=true`).

## 5a. One-time droplet migration to pnpm (2026-07-08)

The repo moved from npm to pnpm (see `DECISIONS.md` › Testing & process). The Forge
config lives **outside the repo**, so an existing droplet needs a one-time update —
**BEFORE pushing the pnpm commits if Quick Deploy is on**, or the next auto-deploy fails:

1. **SSH in, install pnpm:** `corepack enable` (add `sudo` if it can't write the
   symlinks), then `pnpm --version` inside the site directory — it should fetch and
   print the version pinned by the root `packageManager` field. `node --version`
   while you're there (must be 24+).
2. **Deploy Script (Forge UI):** `npm ci --include=dev` → `pnpm install
   --frozen-lockfile`; `npm run build` → `pnpm run build` (keep the
   `VITE_CAPACITYLENS_BUILD_SHA` export line). §5 above shows the target script.
3. **Daemon wrapper** (`run-server.sh`, run by the Background process): the start
   command becomes `pnpm --filter capacitylens-server start`. The old
   `npm start -w capacitylens-server` no longer works at all — the `workspaces`
   field left `package.json` with the migration.
4. Push → deploy → **restart the Background process**. Mandatory this once, even
   though the usual rule is "restart only on `server/` changes": the first pnpm
   install replaces the whole `node_modules` layout (per-workspace symlinks, new
   `tsx` path) under the running daemon.
5. **Verify:** site loads, Settings build stamp says `· server`, and `/api/health`
   returns `{"ok":true}`.

Nothing here is destructive if a step is missed: the DB + backups live outside the
site directory, and a failed build leaves the previous `dist/` serving. The symptom
is a failed deploy (or a daemon that won't restart) — complete the missed step and
redeploy.

## 6. Nginx — SPA fallback (required)

The app uses `createBrowserRouter` (real URLs). Without a fallback, refreshing
a deep link like `/projects` 404s. Site → **⋯** → **Edit Nginx Configuration**,
set the root location block to:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

## 7. Deploy + SSL

- Click **Deploy Now**; watch the script output go green.
- Enable **Quick Deploy** so future pushes auto-deploy.
- Site → **SSL** → **Let's Encrypt** → Obtain Certificate.

## 8. SSH (debugging only)

```bash
ssh forge@<droplet-ip>
cd /home/forge/capacitylens.yourdomain.com
pnpm install --frozen-lockfile && pnpm run build   # reproduce build errors interactively
```

Add your key under Forge → server → **SSH Keys** if `forge@` is refused.

## Data model note

This applies to the **demo build only** (`VITE_CAPACITYLENS_DEMO=1`): static-only means
each visitor's data lives in **their own browser** (`localStorage`). A page refresh keeps
it; clearing browser data, incognito, or a different browser/device starts fresh. There
is no shared dataset. The **default** server-backed build persists to the same-origin
SQLite `/api` instead, so data is shared and durable across people and devices — see the
server path in `server/README.md` (note: per the 2026-06-16 update the alpha runs with no
auth gate).
