# Self-hosting CapacityLens

This is the end-to-end guide for running your own CapacityLens — including **with
authentication**. The primary path is **bare metal**: a host with Node 24 and a web server,
no containers. If you'd rather run containers, the same deployment ships as a Docker Compose
stack — see [§8](#8-running-with-docker-instead-compose) — but Docker is packaging, not a
requirement.

CapacityLens is an agency resource & capacity scheduler (a helicopter view of who's busy,
free, or overworked, at week granularity). Self-hosting gives you your data in a **SQLite**
file on a disk you control, and a **privacy-first** posture: no email infrastructure, no
telemetry, no third-party analytics. You own the box and the data.

> **A note on honesty:** this guide documents what ships **today**. Where a feature is planned
> but not yet built (e.g. self-service signup, native multi-provider social-login buttons), it
> says so explicitly rather than implying it exists.

---

## 1. What you get / prerequisites

A CapacityLens deployment is just **two pieces**:

1. the **API daemon** — Node 24 running Fastify against a SQLite file, with optional timed
   backups, and
2. the **built SPA** (`dist/`) — static files served by any web server that can also
   reverse-proxy `/api/*` to the daemon (the daemon does **not** serve the SPA itself).
   Same-origin, so the browser never makes a cross-origin call and CORS stays fail-closed.

You need:

- A **host or VM** (a small Linux box is plenty — the DB is KB–MB scale).
- **Node 24+** (the server uses the built-in `node:sqlite`; `.nvmrc` pins `24`).
- **pnpm** via `corepack enable` (the version is pinned by `packageManager` in `package.json`).
- A web server: **nginx**, **Caddy**, or similar.
- **For SSO only:** an account with **Google**, **Microsoft (Entra ID)**, or **GitHub** (or any
  OIDC/OAuth2 identity provider) so you can register an OAuth application. See
  [§4b](#4b-sso-mode--single-oidcoauth2-provider).

That's it. There is no separate database server, no mail server, no message queue.
(Prefer containers? Swap this whole list for Docker + Compose and jump to
[§8](#8-running-with-docker-instead-compose).)

---

## 2. Quick start

### Build

```sh
git clone https://github.com/<your-org>/capacitylens.git
cd capacitylens
corepack enable
pnpm install --frozen-lockfile

# Build the SPA -> dist/. Leave VITE_CAPACITYLENS_API empty for same-origin
# (see "Build-time vs runtime config" below).
pnpm run build
```

### Run the daemon

Pick an access mode **before** first boot — under `NODE_ENV=production` the daemon refuses to
start without one: **either** turn auth on ([§4](#4-enabling-authentication)) **or** explicitly
consent to a trusted-local no-login instance with `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1`.

```sh
NODE_ENV=production \
PORT=8787 \
CAPACITYLENS_DB=/var/lib/capacitylens/capacitylens.db \
CAPACITYLENS_BACKUP_DIR=/var/lib/capacitylens/backups \
CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1 \
pnpm --filter capacitylens-server start
```

The daemon binds loopback by default (set `CAPACITYLENS_HOST` to change) — correct for this
topology, where only the web server reaches it.

> **The production-posture interlock.** `server/src/productionGuard.ts` refuses to boot with
> auth OFF under `NODE_ENV=production` unless you've deliberately opted in via the flag above.
> Skip that step and the daemon **exits on boot** (under systemd's `Restart=on-failure` it
> restart-loops) — check the log (`journalctl -u capacitylens -e`) for the "refusing to
> start" line.

### Keep it alive (systemd)

```ini
# /etc/systemd/system/capacitylens.service
[Unit]
Description=CapacityLens API daemon
After=network.target

[Service]
WorkingDirectory=/opt/capacitylens
ExecStart=/usr/local/bin/pnpm --filter capacitylens-server start
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=8787
Environment=CAPACITYLENS_DB=/var/lib/capacitylens/capacitylens.db
Environment=CAPACITYLENS_BACKUP_DIR=/var/lib/capacitylens/backups
# Pick an access mode (above / §4): auth on, or explicit open-mode consent:
Environment=CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1

[Install]
WantedBy=multi-user.target
```

Adjust the `pnpm` path to `which pnpm` on your host, and put your `BETTER_AUTH_*` /
`CAPACITYLENS_SSO_*` variables here (or an `EnvironmentFile=`) when auth is on.

### Serve the SPA + proxy /api

The block below is the repo's [`nginx.conf`](../nginx.conf) with only three lines changed: the
`server_name`, `root`, and `proxy_pass` (to your domain, your build path, and your local daemon):

```nginx
server {
    listen 80;
    server_name capacity.example.com;

    root /opt/capacitylens/dist;
    index index.html;

    # Compression for text assets (Vite emits hashed JS/CSS).
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # Hashed asset filenames are content-addressed -> cache forever.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # Reverse-proxy the API to the local daemon. The server mounts every route
    # under /api/, so the prefix is preserved (no rewrite). 8787 is the server's default PORT.
    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 60s;
    }

    # SPA history-API fallback: unknown paths return index.html so client-side
    # routes (react-router) resolve. index.html itself is never cached so a fresh
    # deploy is picked up immediately.
    location / {
        add_header Cache-Control "no-cache";
        try_files $uri $uri/ /index.html;
    }
}
```

Same-origin is the point: the browser only ever talks to the web server, `/api` never crosses
an origin, and CORS stays fail-closed (leave `CAPACITYLENS_CORS_ORIGIN` unset). Put TLS on
this server block as you would for any site (Certbot/Caddy), and set `BETTER_AUTH_URL` to the
public origin if auth is on.

### First run

Open your site. A fresh instance starts **empty** — there's no seeded dataset out of the box.
You'll land on the account picker's create-your-company screen: name your one company, pick
its calendar defaults (timezone, week start), and you're in.

> **One company per instance (default).** CapacityLens is single-company-per-instance by
> default: once your one company exists, creating a second one — from the account picker, or a
> direct API call — is refused with:
>
> ```
> This instance allows a single company. Set CAPACITYLENS_MULTI_ACCOUNT=1 to allow more.
> ```
>
> This applies in every auth mode, including auth off, and is enforced only at **create time** —
> an existing DB that already holds several companies (e.g. one seeded before you set the cap)
> keeps working normally either way; updates and deletes are unaffected. To lift the cap, set
> `CAPACITYLENS_MULTI_ACCOUNT=1` in the daemon's environment and restart it.
>
> **`CAPACITYLENS_SEED_DEMO`** is a demo/throwaway-instance affordance, not something a real
> deployment needs: set to `1`, it seeds the two-company demo dataset (Studio North + Loft
> Digital) into a never-initialised DB at boot — which only makes sense together with
> `CAPACITYLENS_MULTI_ACCOUNT=1`, since the seed ships two companies. Leave both unset for a real
> deploy; a real instance is meant to start empty and grow from the one company you create.

### Build-time vs runtime config (important)

CapacityLens splits its configuration in two:

- **Server runtime** (`CAPACITYLENS_*`, `BETTER_AUTH_*`, `PORT`, `NODE_ENV`) is read by the
  daemon when it starts. Change its environment (e.g. the systemd unit), then restart it.
- **Client build-time** (`VITE_CAPACITYLENS_*`) is **inlined into the SPA at build time** by
  Vite. Changing it needs a **rebuild** (`pnpm run build`).

The one that bites people: **`VITE_CAPACITYLENS_API`** is the backend **origin** the browser
talks to (the client appends `/api` itself — so set the origin, **not** `/api`, or you'll get
requests to `/api/api/...`). It defaults to **empty**, which means SAME-ORIGIN server mode: the
SPA calls a relative `/api`, and your web server proxies that to the daemon — this works at
whatever host/port serves the app with no per-host rebuild. You only need to set it if you're
pointing the SPA at a **different** origin than the one serving it; when you do, you must
rebuild, because Vite bakes it into the JS bundle:

```sh
VITE_CAPACITYLENS_API=https://capacity.example.com pnpm run build   # re-inline the origin
```

A build that's missing/wrong here silently falls back to browser-local storage and otherwise
looks identical — confirm `· server` (not `· local`) in the build stamp at the bottom of
Settings after deploying.

---

## 3. Environment configuration

Every runtime variable the app and server actually read is enumerated in **`.env.example`**
with its default and meaning — that file is the source of truth. Don't restate all of them
here. On bare metal, set them in the daemon's environment (the systemd unit or an
`EnvironmentFile=`); with Docker, copy `.env.example` to `.env` and compose forwards them
([§8](#8-running-with-docker-instead-compose)). The ones you should think about for a real
deploy:

| Variable | When | What to set |
| --- | --- | --- |
| `VITE_CAPACITYLENS_API` | different origin only | **Build-time.** The public API origin, e.g. `https://capacity.example.com` (origin, not `/api`). Empty = same-origin (the default topology). Requires a rebuild. |
| `CAPACITYLENS_DB` | always | SQLite file path, e.g. `/var/lib/capacitylens/capacitylens.db` (compose: `/data/capacitylens.db` on the named volume). |
| `CAPACITYLENS_BACKUP_DIR` | recommended | Directory for timed snapshots. Unset = backups OFF. See [§5](#5-backups--restore). |
| `CAPACITYLENS_HEALTH_DEEP` | recommended | `1` makes `/api/health` also do a real DB read (deep healthcheck). |
| `CAPACITYLENS_LOG` | recommended | `1` for structured per-request JSON logs (pino). |
| `CAPACITYLENS_RATE_LIMIT` | recommended | Requests/minute per IP across `/api/*` (default `300`; `/api/health` exempt). |
| `CAPACITYLENS_AUTH` | for auth | `off` (default) \| `password` \| `sso`. See [§4](#4-enabling-authentication). |
| `BETTER_AUTH_SECRET` | auth on | **Required** when auth is on. Session signing secret, **≥32 random chars**. Generate one: `openssl rand -base64 48`. |
| `BETTER_AUTH_URL` | auth on | **Required** when auth is on. The **public origin** the browser uses, e.g. `https://capacity.example.com`. |
| `WEB_PORT` | Docker only | Host port compose publishes the SPA on (default `8080`). |

Boolean flags are ON only when set to exactly `1`. **Never commit a real `.env`** — keep
secrets out of version control (the repo `.gitignore` keeps `.env` out of git, and the
`.dockerignore` keeps it out of the image).

---

## 4. Enabling authentication

Authentication is **off by default**. With `CAPACITYLENS_AUTH` unset or `off`, the auth library
(Better Auth) **never initialises** — no auth tables are created, no `BETTER_AUTH_*` variable is
read, and there's no extra attack surface. Turning auth on is purely a matter of environment
variables; no code changes.

A **multi-agency hosted** instance (one server shared by separate organisations) **must run auth on**
(`CAPACITYLENS_AUTH=password` or `sso`): with auth on there is **no unauthenticated `/api` access**
— every API request except `/api/health` and `/api/auth/*` requires a signed-in session. A
**single-agency-on-a-box** deployment may run auth **off** (the trusted-local default), where the
whole dataset is intentionally open to anyone who can reach the server.

There are two modes: **`password`** (email + password) and **`sso`** (a single OIDC/OAuth2
identity provider). **Both** require:

- `CAPACITYLENS_AUTH` set to `password` or `sso`,
- `BETTER_AUTH_SECRET` (≥32 random chars — `openssl rand -base64 48`),
- `BETTER_AUTH_URL` (your **public origin**, e.g. `https://capacity.example.com`).

If a required variable is missing, the daemon **refuses to boot** with a clear message (check
`journalctl -u capacitylens -e`, or `docker compose logs api`) rather than starting
half-configured.

### 4a. `password` mode (email + password)

```sh
CAPACITYLENS_AUTH=password
BETTER_AUTH_SECRET=<output of: openssl rand -base64 48>
BETTER_AUTH_URL=https://capacity.example.com
```

Then restart the daemon (`systemctl restart capacitylens`, or `docker compose up -d`). Better
Auth creates its own tables (`user`, `session`, `account`, `verification`) inside the **same**
SQLite file on first boot.

**First user (owner) — no flags needed.** While the `user` table has **zero rows**, the login
screen offers **Create the owner account** (name / email / password) instead of sign-in — that
first sign-up is the bootstrap, and the moment it exists, self-registration closes again
automatically (no restart needed). Just visit the site after the first auth-enabled boot and
create your account.

> ⚠️ **Claim the instance before (or the moment) it is reachable.** Until the owner account
> exists, *anyone* who can reach the URL can create it — a scanner that finds a fresh instance
> first owns it (with zero accounts, any signed-in user may create the first company). Complete
> the owner sign-up immediately after the first auth-enabled boot, or do the first boot before
> exposing the site publicly (bind to localhost / firewall it, sign up, then open it up). If you
> are beaten to it, stop the daemon and delete the DB file — the next boot starts fresh.

For headless/scripted deploys there is an escape hatch: start the daemon once with
`--create-owner-admin-admin` (or `CAPACITYLENS_CREATE_ADMIN_ADMIN=1`) and, **only if the user
table is empty**, it creates the owner `admin@admin.admin` with password `admin` — a
**well-known credential**: the boot log prints a loud framed warning, and you must sign in and
change that password immediately (Settings → Members → Reset password), then drop the flag.
With users already present the flag logs one "skipped" line and boots normally; with auth off
or `sso` it refuses to boot (it's meaningless there).

> **After the first user, signup is invite-only by design — and `password` mode needs one manual
> step per new user.** Self-service public signup is intentionally **closed**
> (`CAPACITYLENS_ALLOW_OPEN_SIGNUP` unset): CapacityLens has no email infrastructure (no verification
> or password-reset mail), so opening signup on a shared instance is a footgun. Note that an
> **invite binds a role to an already-signed-in user** — it does not, by itself, create a login — so
> in `password` mode there is no self-serve path for a brand-new person to get in. Two options:
>
> 1. **Admin-provisioned credential (fine for a small team).** Briefly set
>    `CAPACITYLENS_ALLOW_OPEN_SIGNUP=1`, have the new person create their email + password account (or
>    create it for them via `POST /api/auth/sign-up/email`), then turn the flag **back off**. Once they
>    are signed in, they accept the invite link, which grants the role.
> 2. **Use `sso` mode instead** (§4b). With SSO the identity provider creates the user on first
>    sign-in, so an invite is all that's needed — no manual credential step. This is the smoother path
>    for anything beyond a handful of password users.
>
> Full self-serve password onboarding (set-your-password-from-an-invite) needs email delivery, which is
> a deliberate non-goal today — so treat `password` mode as a small, controlled set of accounts.

**Forgotten passwords — admin-issued reset links (no email needed).** An Owner or Admin opens
**Settings → Members** and clicks **Reset password** on the member's row. That mints a
**single-use link, valid for 24 hours**, shown exactly once — copy it and hand it to the person
directly (chat, however you like). Opening the link works **without being signed in** (that's the
point); the person chooses a new password there and signs in with it. Every existing session for
that member is revoked when the reset completes. Two deliberate guardrails: an Admin can reset
anyone **except an Owner** (only an Owner may reset an Owner — a reset link is an account-takeover
capability), and the link is never stored or shown again after that first response. This also
works for setting a first password on an account created via social sign-in.

### 4b. `sso` mode — single OIDC/OAuth2 provider

`sso` mode wires **one** generic OAuth2/OIDC provider entirely from environment variables. You
point it at Google, Microsoft, GitHub, or any OIDC IdP — **one provider at a time**.

> **What this is / isn't (today):** there is **no** panel of native Google/Microsoft/GitHub
> social-login buttons yet — that multi-provider experience is **planned, not implemented**.
> Today you configure exactly **one** provider via the `CAPACITYLENS_SSO_*` variables below.

Common variables:

```sh
CAPACITYLENS_AUTH=sso
BETTER_AUTH_SECRET=<output of: openssl rand -base64 48>
BETTER_AUTH_URL=https://capacity.example.com

CAPACITYLENS_SSO_CLIENT_ID=<from your provider>
CAPACITYLENS_SSO_CLIENT_SECRET=<from your provider>
# Optional. Default `sso`. Used in the callback URL path (see below) — if you change it,
# change the redirect URL you register too.
CAPACITYLENS_SSO_PROVIDER_ID=sso
# Optional. Default: openid profile email
CAPACITYLENS_SSO_SCOPES=openid profile email
```

…**plus EITHER** an OIDC discovery URL **OR** explicit endpoints:

```sh
# OIDC providers (Google, Microsoft, most IdPs): one discovery URL.
CAPACITYLENS_SSO_DISCOVERY_URL=https://idp.example.com/.well-known/openid-configuration

# OR, for plain OAuth2 (e.g. GitHub): the two endpoints, no discovery URL.
CAPACITYLENS_SSO_AUTHORIZATION_URL=https://idp.example.com/authorize
CAPACITYLENS_SSO_TOKEN_URL=https://idp.example.com/token
```

The daemon refuses to boot in `sso` mode unless you provide the discovery URL **or** both the
authorization and token URLs.

#### The redirect / callback URL (get this exactly right)

Whatever provider you use, the **Authorized redirect URI** (a.k.a. callback / reply URL) you
register with that provider is the Better Auth generic-OAuth callback:

```
${BETTER_AUTH_URL}/api/auth/oauth2/callback/${CAPACITYLENS_SSO_PROVIDER_ID}
```

With the defaults (`CAPACITYLENS_SSO_PROVIDER_ID=sso`) and
`BETTER_AUTH_URL=https://capacity.example.com`, that is:

```
https://capacity.example.com/api/auth/oauth2/callback/sso
```

Getting this URL right is the single most common cause of SSO failures (the provider rejects
the login with a redirect-URI-mismatch error). If a Better Auth upgrade ever changes the
callback path, confirm the exact path against the
[Better Auth generic-OAuth docs](https://www.better-auth.com/docs/plugins/generic-oauth) and
the server's mounted `/api/auth` routes before filing a bug.

#### Register the OAuth app

##### Google

1. Open the **Google Cloud Console** → **APIs & Services** → **Credentials**.
2. **Create Credentials** → **OAuth client ID** → Application type **Web application**.
3. Under **Authorized redirect URIs**, add the callback URL above
   (`https://capacity.example.com/api/auth/oauth2/callback/sso`).
4. Copy the **Client ID** and **Client secret** into `CAPACITYLENS_SSO_CLIENT_ID` /
   `CAPACITYLENS_SSO_CLIENT_SECRET`.
5. Set the discovery URL:
   ```sh
   CAPACITYLENS_SSO_DISCOVERY_URL=https://accounts.google.com/.well-known/openid-configuration
   ```

##### Microsoft (Entra ID / Azure AD)

1. Open the **Microsoft Entra admin center** (Azure AD) → **App registrations** → **New
   registration**.
2. Choose the supported account types you want, and add a **Web** platform **Redirect URI** set
   to the callback URL above.
3. Under **Certificates & secrets**, create a **client secret**; copy its **value** (not the ID).
4. Copy the **Application (client) ID** and the secret into `CAPACITYLENS_SSO_CLIENT_ID` /
   `CAPACITYLENS_SSO_CLIENT_SECRET`.
5. Set the discovery URL (replace `<tenant>` with your tenant ID, or use `common` for
   multi-tenant):
   ```sh
   CAPACITYLENS_SSO_DISCOVERY_URL=https://login.microsoftonline.com/<tenant>/v2.0/.well-known/openid-configuration
   ```

##### GitHub

GitHub is **OAuth2, not OIDC** — there is no discovery document, so use the explicit endpoints.

1. Open **GitHub** → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
2. Set the **Authorization callback URL** to the callback URL above
   (`https://capacity.example.com/api/auth/oauth2/callback/sso`).
3. Register, then **generate a client secret**; copy the **Client ID** and the secret into
   `CAPACITYLENS_SSO_CLIENT_ID` / `CAPACITYLENS_SSO_CLIENT_SECRET`.
4. Set the endpoints and scopes (no discovery URL):
   ```sh
   CAPACITYLENS_SSO_AUTHORIZATION_URL=https://github.com/login/oauth/authorize
   CAPACITYLENS_SSO_TOKEN_URL=https://github.com/login/oauth/access_token
   CAPACITYLENS_SSO_SCOPES=read:user user:email
   ```

After changing the environment, restart the daemon and watch its log for the startup line (or
a "refusing to start" message if something's missing).

---

## 5. Backups & restore

When `CAPACITYLENS_BACKUP_DIR` is set, the daemon writes **WAL-safe online snapshots** of the
SQLite database — once at boot, then every `CAPACITYLENS_BACKUP_INTERVAL_MIN` minutes (default
60), keeping the newest `CAPACITYLENS_BACKUP_KEEP` files (default 48, oldest pruned). With the
defaults that's an hourly snapshot and roughly a recovery-point objective of ≤ 1 hour.

The snapshots are ordinary files in that directory — list them with `ls -lt`, ship them
off-box with `scp`/`rsync` like any other file. (Docker: they're on the `capacitylens-backups`
named volume — see [§8](#8-running-with-docker-instead-compose) for the `docker compose exec` /
`cp` equivalents.)

> **Do not `cp` the live database file** while the daemon is running — it uses WAL mode, and a
> raw copy can be torn. Use the daemon's snapshots (above), which are taken WAL-safely.

**Restoring** a snapshot (stop the daemon, swap the file, clear stale WAL sidecars, restart) is
a procedure that should be **drilled**, not improvised. The exact, tested sequence lives in the
operations runbook — it's written for exactly this daemon-on-a-host topology, so follow it
rather than reinventing it:

→ **[`docs/runbook.md`](runbook.md) → "Restore"** for the step-by-step restore sequence.

---

## 6. Upgrades

```sh
# 1. take a fresh backup first (a snapshot you've verified you can restore)
ls -lt /var/lib/capacitylens/backups        # or trigger one by restarting the daemon

# 2. pull the new code and rebuild
git pull
pnpm install --frozen-lockfile
pnpm run build

# 3. restart the daemon (the SPA is picked up on the next page load)
systemctl restart capacitylens
```

If the upgrade changes the data schema, the server migrates the SQLite file in place on boot.
If you set `VITE_CAPACITYLENS_API` (different-origin deploys only), remember it's baked into
the bundle — the `pnpm run build` step is what applies a change to it.

**Always take and verify a backup before upgrading** — a backup you've never restored is a hope,
not a backup.

(Docker: the same sequence is `git pull` → `docker compose build` → `docker compose up -d`,
with your data safe on the named volume — [§8](#8-running-with-docker-instead-compose).)

---

## 7. Troubleshooting / notes

- **Health check.** `GET /api/health` is unauthenticated and rate-limit-exempt. By default it
  returns `{ ok: true }` unconditionally; with `CAPACITYLENS_HEALTH_DEEP=1` it also does a
  trivial DB read and returns `{ ok: true, db: true, audit: 'ok' | 'degraded' }` (200) or
  `{ ok: false }` (503) if the DB is broken while the process is alive. (`audit` is a soft
  signal — a `'degraded'` audit stays a 200.)
- **Logs.** `journalctl -u capacitylens -f` for the daemon (with `CAPACITYLENS_LOG=1`, one JSON
  line per request plus hourly backup lines); your web server's own logs for the SPA side.
  (Docker: `docker compose logs -f api` / `web`.)
- **CORS.** The default topology is **same-origin** — the browser talks to your web server,
  which proxies `/api/*` to the daemon, so no cross-origin request is ever made and CORS stays
  fail-closed. **Leave `CAPACITYLENS_CORS_ORIGIN` unset.** Only set it if you deliberately
  serve the SPA and the API on **different** origins — and then set it to the **exact SPA
  origin(s)** (comma-separated). `*` cannot work for the web client: the client sends
  credentialed requests (`credentials: 'include'`), browsers reject a wildcard origin with
  credentials, and the server accordingly never sends `Access-Control-Allow-Credentials`
  for `*` — the wildcard only serves non-credentialed API scripting (curl, server-to-server).
- **"Refusing to start."** If the daemon exits on boot, read the log line — it fails loudly
  on misconfiguration (bad `CAPACITYLENS_AUTH` value, missing `BETTER_AUTH_SECRET` /
  `BETTER_AUTH_URL` with auth on, out-of-range `PORT`, etc.) instead of limping along.
- **The daemon exits/restart-loops on boot with auth off.** This is the production-posture
  interlock (`server/src/productionGuard.ts`): under `NODE_ENV=production` the daemon refuses
  to boot with auth OFF unless you've explicitly opted in. Fix: either enable auth
  ([§4](#4-enabling-authentication)) or set `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1` for the
  trusted-local no-login mode, then restart. You'll see the "refusing to start" line in the
  log until it's fixed.
- **`· local` instead of `· server`** in the Settings build stamp means the SPA was built
  with a wrong `VITE_CAPACITYLENS_API` and is using browser-local storage — fix the variable
  and rebuild (`pnpm run build`; see [§2](#2-quick-start)).
- **The audit log.** The append-only `capacitylens-audit.jsonl` lives alongside the DB. It is
  **on by default** (disable with `CAPACITYLENS_AUDIT=off`, relocate with
  `CAPACITYLENS_AUDIT_FILE`) and self-rotates at `CAPACITYLENS_AUDIT_MAX_MB` (default 64 MB):
  the previous generation is kept as `capacitylens-audit.jsonl.1`, bounding disk use at roughly
  2× the cap.
- **Privacy posture.** No telemetry is emitted (the auth library's telemetry is explicitly
  disabled), there is no email infrastructure, and there are no third-party analytics. Your
  data stays in the SQLite file on your disk.

---

## 8. Running with Docker instead (Compose)

If you prefer containers, the same two pieces ship as a Compose stack built from one
multi-stage `Dockerfile`:

| Service | Image | Role |
| --- | --- | --- |
| `web` | nginx | Serves the built SPA; reverse-proxies `/api/*` to `api` over the compose network. Published on `${WEB_PORT:-8080}`. |
| `api` | Node 24 (Fastify) | The API daemon: reads/writes the SQLite DB, runs the backup timer, hosts `/api/health` and (when enabled) `/api/auth/*`. Not published directly — only `web` reaches it. |

```sh
git clone https://github.com/<your-org>/capacitylens.git
cd capacitylens

cp .env.example .env
# edit .env — the same variables as §3 (compose forwards them to the api container).
# Pick an access mode BEFORE first boot, exactly as in §2:
#   EITHER turn auth on (§4): CAPACITYLENS_AUTH=password|sso + BETTER_AUTH_SECRET/BETTER_AUTH_URL
#   OR, for a trusted-local no-login instance, set in .env:
#     CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1

docker compose up --build -d
```

Then open **<http://localhost:8080>** (override with `WEB_PORT` in `.env`) — first run behaves
exactly as [§2 "First run"](#first-run).

Docker-specific notes; everything else in §3–§7 applies unchanged:

- **The interlock, containerised.** The `api` image bakes `NODE_ENV=production`, so skipping
  the access-mode step makes the `api` container **restart-loop** (`restart: unless-stopped`)
  instead of coming up — check `docker compose logs api` for the "refusing to start" line.
- **Runtime config** comes from `.env` (compose auto-loads it and forwards the variables to
  the `api` container). Change `.env`, then `docker compose up -d` to apply. **Build-time**
  `VITE_CAPACITYLENS_*` variables are compose build args — changing one needs
  `docker compose build && docker compose up -d`.
- **Data** lives on two **named volumes**, so `docker compose up --build` (a rebuild) keeps it:
  `capacitylens-db` → the SQLite file at `/data/capacitylens.db` (+ WAL sidecars) and the audit
  log; `capacitylens-backups` → timed snapshots at `/backups`.
- **Copying a snapshot out** of the volume to the host:

  ```sh
  docker compose exec api ls -lt /backups                  # list snapshots
  docker compose cp api:/backups/<snapshot-file>.db ./     # copy one out
  ```

- **Restore** follows the same runbook sequence as bare metal ([§5](#5-backups--restore));
  the equivalents are the `capacitylens-db` volume and `docker compose stop api` / `start api`.
- **Upgrades:** backup first, then `git pull` → `docker compose build` → `docker compose up -d`.
- **Logs:** `docker compose logs -f api` / `docker compose logs -f web`. The container
  `HEALTHCHECK` already hits `/api/health`.

---

For deeper operational detail (deploy topology, monitoring, the production flag register) see
[`docs/production-plan.md`](production-plan.md), [`docs/runbook.md`](runbook.md), and
[`server/README.md`](../server/README.md).
