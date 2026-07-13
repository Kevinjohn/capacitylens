# Deploying CapacityLens (Laravel Forge + DigitalOcean)

**This is the end-to-end runsheet for the Forge droplet deployment** — the server-backed
build (static SPA + same-origin SQLite `/api` daemon) with **password auth on**. It was
rewritten 2026-07-11 after two changes that break the old Forge config:

1. **npm → pnpm** (2026-07-08): every `npm` command in the Deploy Script and daemon
   wrapper is dead (`npm start -w` has no `workspaces` field to resolve anymore).
2. **Auth landed** (password mode + invites + admin-issued reset links): the server now
   **refuses to boot** under `NODE_ENV=production` with auth off, and needs three new
   env vars.

The Forge config (Deploy Script, daemon command, env) lives **outside the repo**, so none
of this updates itself on `git pull` — it's a one-time manual update, done **before**
pushing if Quick Deploy is on. §9 is the delta checklist for the existing droplet; §§1–8
are the from-scratch setup. This runsheet assumes a **fresh dataset** (demo stage — the
old DB is deleted, not migrated).

> Generic (non-Forge) self-hosting — systemd, Docker, full env register — lives in
> [`self-hosting.md`](self-hosting.md). Day-to-day operations live in
> [`runbook.md`](runbook.md). The legacy static/localStorage **demo** build is §10.

## How it fits together

- **nginx** serves the built SPA from `dist/` (Forge "Static HTML" site) and proxies
  `/api` to the daemon on `127.0.0.1:8787` (same origin — the client needs no API URL).
- **The daemon** (Forge Background process) runs the Fastify + `node:sqlite` server via
  `run-server.sh`. The SQLite file lives **outside** the site directory
  (`/home/forge/capacitylens-data/`) so deploys never touch data.
- **Better Auth** runs its own table migrations inside the same SQLite file at every
  daemon boot — there is no separate migration step, ever.

## 1. DNS

Add an **A record** for the subdomain pointing at the droplet's public IP
(e.g. `capacitylens` → `203.0.113.10`).

## 2. Create the Site in Forge

Forge → server → **New Site**:

- **Root Domain:** `capacitylens.yourdomain.com`
- **Project Type:** `Static HTML`
- **Web Directory:** `/dist`  ← serves the Vite build output, not `/public`.

Then Site → **Apps** → **Git Repository**: select provider, repo, branch. Leave
"Install Composer Dependencies" unchecked (no PHP).

## 3. Node 24 + pnpm (one-time, SSH)

```bash
node --version     # must be 24+ (node:sqlite is unflagged there; pinned by .nvmrc + engines)
corepack enable    # sudo if it can't write the symlinks
cd /home/forge/capacitylens.yourdomain.com && pnpm --version
# ^ fetches + prints the version pinned by the root packageManager field
```

There is no separate pnpm install — corepack reads `"packageManager"` from the repo.

## 4. Deploy Script

Site → **Apps** → **Deploy Script**:

```bash
cd /home/forge/capacitylens.yourdomain.com

git pull origin $FORGE_SITE_BRANCH

# --frozen-lockfile pins the install to pnpm-lock.yaml (CI-style, no drift).
pnpm install --frozen-lockfile

# Build stamp shown in Settings ("build <sha> · server") — the deploy-verification oracle.
export VITE_CAPACITYLENS_BUILD_SHA=$(git rev-parse --short HEAD)

pnpm run build   # paraglide:compile && tsc -b && vite build  ->  dist/
```

**Do NOT set `VITE_CAPACITYLENS_API`** — since v0.11 an empty value *is* the same-origin
server mode this deployment wants (it's an origin *override*, not an on-switch). And never
set `VITE_CAPACITYLENS_DEMO` here — that builds the backend-less localStorage demo (§10).
If the build fails with `vite: not found` / `tsc: not found`, a droplet config is setting
`production=true`; prepend `pnpm install --prod=false`.

## 5. The daemon (Background process)

`run-server.sh` (kept at `/home/forge/capacitylens-data/run-server.sh`, outside the site
dir so deploys can't clobber it), `chmod +x`:

```bash
#!/usr/bin/env bash
cd /home/forge/capacitylens.yourdomain.com

export NODE_ENV=production
export CAPACITYLENS_DB=/home/forge/capacitylens-data/capacitylens.db

# Auth (password mode). Generate both secrets before first boot.
export CAPACITYLENS_AUTH=password
export BETTER_AUTH_SECRET='<paste openssl rand -base64 48 output>'
export BETTER_AUTH_URL=https://capacitylens.yourdomain.com   # the PUBLIC origin
export CAPACITYLENS_SETUP_TOKEN='<paste openssl rand -base64 32 output>'

# CAPACITYLENS_HTTPS stays OFF: TLS terminates at nginx; the flag reflects the
# daemon's own protocol (see server/README.md).

# Recommended operational extras
export CAPACITYLENS_HEALTH_DEEP=1                            # /api/health does a real DB read
export CAPACITYLENS_BACKUP_DIR=/home/forge/capacitylens-data/backups
export CAPACITYLENS_RATE_LIMIT=300                           # req/min per IP across /api/*

exec pnpm --filter capacitylens-server start
```

Forge → server → **Daemons** (Background process): command
`/home/forge/capacitylens-data/run-server.sh`, user `forge`, directory
`/home/forge/capacitylens.yourdomain.com`.

Notes on what you're choosing here:

- `CAPACITYLENS_AUTH=password` + the two `BETTER_AUTH_*` vars is the whole auth switch.
  Sign-up is **closed by default** (invite-only); first user is bootstrapped in §7.
- Auth-off in production is a deliberate boot **refusal** now (the old open-alpha posture);
  `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1` exists to override it — don't.
- The default instance is **single-company**: the second org create 403s unless
  `CAPACITYLENS_MULTI_ACCOUNT=1`.
- A fresh DB starts **empty** — no demo seed unless `CAPACITYLENS_SEED_DEMO=1` (don't, for
  a real instance).
- Audit logging is on by default (JSONL beside the DB); leave it.

## 6. Nginx — SPA fallback + `/api` proxy (both required)

Site → **⋯** → **Edit Nginx Configuration**. Forge splices what you paste into its
generated `server { … }` block, so top-level `add_header` lines and `location` blocks are
both valid here:

```nginx
# Security headers (helmet parity — nginx serves the HTML, so Fastify's helmet can't
# add these for you; a meta CSP cannot express frame-ancestors).
add_header Content-Security-Policy "frame-ancestors 'none'; object-src 'none'; base-uri 'none'" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
add_header X-Content-Type-Options "nosniff" always;

# Real URLs (createBrowserRouter): without this, refreshing /projects 404s.
location / {
    try_files $uri $uri/ /index.html;
}

# Same-origin API → the daemon. NO trailing slash on proxy_pass (path passes through).
location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Invite/reset links carry single-use bearer tokens in the URL PATH — they must never
# reach access.log (the daemon's log redaction only covers /api requests).
location ~ ^/(invite|reset-password)/ {
    access_log off;
    add_header Cache-Control "no-cache";
    # Re-declared: nginx inheritance — a location with ANY add_header of its own drops
    # every inherited one, so the server-level security set must be repeated here.
    add_header Content-Security-Policy "frame-ancestors 'none'; object-src 'none'; base-uri 'none'" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Content-Type-Options "nosniff" always;
    # index.html served IN-PLACE: a $uri-style fallback would internally redirect to
    # location /, where the token-bearing request line gets access-logged anyway.
    try_files /index.html =404;
}
```

(The repo's [`nginx.conf`](../nginx.conf) is the reference for all of this — same headers,
same token-path handling — if you're wiring nginx by hand instead of through Forge.)

## 7. First deploy + first user (bootstrap)

1. **Fresh dataset** (demo stage, nothing kept): with the daemon stopped, delete the old
   data — `rm /home/forge/capacitylens-data/capacitylens.db*` (the `*` catches WAL/SHM)
   and the old `capacitylens-audit.jsonl` if present. The next boot creates an empty DB
   and runs the Better Auth migrations into it.
2. Click **Deploy Now**; watch it go green. Enable **Quick Deploy**. Site → **SSL** →
   **Let's Encrypt**.
3. **Start the daemon.** After the *first* pnpm install (and after any `server/` change),
   a daemon **restart is mandatory** — pnpm replaces the whole `node_modules` layout under
   a running process.
4. **Bootstrap the first login:** with **zero users** in the DB, the login screen offers
   **Create the owner account** — fill in name / email / password and the configured
   `CAPACITYLENS_SETUP_TOKEN`. A visitor without that operator secret cannot claim the instance.
   The moment the first identity exists, sign-up closes again automatically. Then:
   - create the first company when prompted (with zero accounts in the DB, any signed-in
     user may create the first org);
   - from here on new people join via **Settings → Members → Invite**; the invite page lets a new
     password user create their credential without opening public registration. Forgotten passwords
     use the admin-issued **Reset password** link on the member
     row (single-use, 24 h).

   *Headless alternative:* start the daemon once with `--create-owner-admin-admin` (or
   `CAPACITYLENS_CREATE_ADMIN_ADMIN=1`) to create the owner `admin@admin.admin` /
   password `admin` on the empty user table — a **well-known credential** (the boot log
   prints a loud framed warning): **sign in and change it immediately**, then drop the
   flag. With users already present it logs one "skipped" line and boots normally.

## 8. Verify

- Site loads over HTTPS; Settings shows `build <sha> · server` matching the deployed SHA.
- `curl -s https://capacitylens.yourdomain.com/api/health` → `{"ok":true,"db":true,...}`.
- You can sign out and back in; a second browser gets the login screen (no open data).

## 9. Migrating the EXISTING droplet (delta checklist)

For the droplet that was running the pre-pnpm, auth-off alpha. Do this **before pushing**
if Quick Deploy is on. Nothing here is destructive to the deploy itself — a failed build
leaves the previous `dist/` serving; the symptom of a missed step is a failed deploy or a
daemon that won't boot (its log says exactly which env var it refused on).

1. SSH in: `corepack enable`, verify `node --version` is 24+ and `pnpm --version` prints
   (§3).
2. **Deploy Script**: `npm ci --include=dev` → `pnpm install --frozen-lockfile`;
   `npm run build` → `pnpm run build`; **delete any `export VITE_CAPACITYLENS_API=...`
   line** (same-origin is the default now); keep/add the `VITE_CAPACITYLENS_BUILD_SHA`
   line (§4 is the target script).
3. **`run-server.sh`**: start command becomes `pnpm --filter capacitylens-server start`
   (the old `npm start -w capacitylens-server` cannot work — the `workspaces` field is
   gone). Add the auth env block and flip `NODE_ENV` to `production` (§5 is the target
   file). Without the auth vars, `NODE_ENV=production` **refuses to boot** — that's the
   posture guard working, not a bug.
4. **Wipe the old open-alpha data** (nothing worth keeping): stop the daemon,
   `rm /home/forge/capacitylens-data/capacitylens.db*` + the audit JSONL (§7.1).
5. Confirm the nginx `/api` proxy block exists (§6 — it did on the alpha; unchanged).
6. Push → deploy → **restart the daemon** (mandatory this once — first pnpm install).
7. Bootstrap the first user (§7.4), then verify (§8).

## 10. Legacy: the static localStorage **demo** build

The backend-less build is an explicit opt-in and needs steps 1–2 + the SPA-fallback half
of §6 only — no daemon, no `/api` proxy, no env beyond the flag:

```bash
pnpm install --frozen-lockfile
VITE_CAPACITYLENS_DEMO=1 pnpm run build
```

Each visitor's data then lives in **their own browser** (`localStorage`, key
`capacitylens/v3`): refresh keeps it, clearing browser data / incognito / another device
starts fresh, and there is no shared dataset and no login. A plain build (no flag) on a
static host **does not fall back** to localStorage — it boots to a "can't reach the
server" screen.
