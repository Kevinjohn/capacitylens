# Deploying Floaty (Laravel Forge + DigitalOcean)

Floaty is a Vite/React SPA in an npm-workspaces monorepo. It builds to a static
`dist/` and, by default, persists to the browser's `localStorage` — no backend
required. The `server/` (Fastify + SQLite) is **opt-in** via the build-time
`VITE_FLOATY_API` env var and is documented separately in `server/README.md`.

This guide covers the **static SPA** deploy (the default). You don't SSH in to run
npm by hand — Forge's **Deploy Script** runs `git pull` + the npm build on the
droplet for you on each deploy. SSH is only for debugging.

> **Superseded for the controlled demo:** the demo runs in **server mode** (daemon +
> `/api` proxy + Basic Auth + persistent SQLite). The cutover runsheet is
> [`production-plan.md`](production-plan.md) Phase 2 and day-to-day operations live in
> [`runbook.md`](runbook.md) — follow those, not just this page, or you'll ship a
> localStorage-only build. The DNS/SSL/Nginx basics below still apply.

## 1. DNS

Add an **A record** for the subdomain pointing at the droplet's public IP
(e.g. `floaty` → `203.0.113.10`).

## 2. Create the Site in Forge

Forge → server → **New Site**:

- **Root Domain:** `floaty.yourdomain.com`
- **Project Type:** `Static HTML`
- **Web Directory:** `/dist`  ← serves the Vite build output, not `/public`.

## 3. Connect the Git repo

Site → **Apps** → **Git Repository**. Select provider, repo, and branch.
Leave "Install Composer Dependencies" unchecked (no PHP).

## 4. Node version

Ensure the Forge server runs **Node 20 or 22** (Vite 8 needs ≥18; 22 is safest).

## 5. Deploy Script

Site → **Apps** → **Deploy Script**:

```bash
cd /home/forge/floaty.yourdomain.com

git pull origin $FORGE_SITE_BRANCH

# --include=dev guards against NODE_ENV=production, which would skip the
# devDependencies (vite, tsc, tailwind) and break the build with "vite: not found".
npm ci --include=dev

npm run build   # tsc -b && vite build  ->  dist/
```

If the build still fails with `vite: not found` / `tsc: not found`, prepend
`export NODE_ENV=development` to the script.

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
cd /home/forge/floaty.yourdomain.com
npm ci --include=dev && npm run build   # reproduce build errors interactively
```

Add your key under Forge → server → **SSH Keys** if `forge@` is refused.

## Data model note

Static-only means each visitor's data lives in **their own browser** (`localStorage`).
A page refresh keeps it; clearing browser data, incognito, or a different
browser/device starts fresh. There is no shared dataset. For shared/persisted
data across people and devices, see the server path in `server/README.md`
(note: no auth yet — Phase 2).
