# Self-hosting CapacityLens

This is the end-to-end guide for running your own CapacityLens — including **with
authentication**. If you have Docker and a host to put it on, you can follow this page from
top to bottom and end up with a working, persistent, optionally-authenticated deployment.

CapacityLens is an agency resource & capacity scheduler (a helicopter view of who's busy,
free, or overworked, at week granularity). Self-hosting gives you **one reproducible image**,
your data in a **SQLite** file on a volume you control, and a **privacy-first** posture: no
email infrastructure, no telemetry, no third-party analytics. You own the box and the data.

> **A note on honesty:** this guide documents what ships **today**. Where a feature is planned
> but not yet built (e.g. self-service signup, native multi-provider social-login buttons), it
> says so explicitly rather than implying it exists.

---

## 1. What you get / prerequisites

You get two containers, built from one multi-stage `Dockerfile`:

- **`web`** — nginx serving the built single-page app and reverse-proxying `/api/*` to the API
  (same-origin, so the browser never makes a cross-origin call and CORS stays fail-closed).
- **`api`** — the Fastify daemon (Node 24) with a SQLite database and optional timed backups,
  both on **named Docker volumes** so your data survives container rebuilds.

You need:

- **Docker** and **Docker Compose** (the `docker compose` v2 CLI).
- A **host or VM** to run them on (a small Linux box is plenty — the DB is KB–MB scale).
- **For SSO only:** an account with **Google**, **Microsoft (Entra ID)**, or **GitHub** (or any
  OIDC/OAuth2 identity provider) so you can register an OAuth application. See
  [§4b](#4b-sso-mode--single-oidcoauth2-provider).

That's it. There is no separate database server, no mail server, no message queue.

---

## 2. Quick start

```sh
git clone https://github.com/<your-org>/capacitylens.git
cd capacitylens

cp .env.example .env
# edit .env — see §3 (for a real deploy you MUST set the public URL + a secret if auth is on)

docker compose up --build -d
```

Then open **<http://localhost:8080>** — that's the host port the `web` service publishes (it
maps to nginx on port 80 inside the container; override with `WEB_PORT` in `.env`).

### The two services

| Service | Image | Role |
| --- | --- | --- |
| `web` | nginx | Serves the built SPA; reverse-proxies `/api/*` to `api` over the compose network. Published on `${WEB_PORT:-8080}`. |
| `api` | Node 24 (Fastify) | The API daemon: reads/writes the SQLite DB, runs the backup timer, hosts `/api/health` and (when enabled) `/api/auth/*`. Not published directly — only `web` reaches it. |

Your data lives on two **named volumes**, so `docker compose up --build` (a rebuild) keeps it:

- `capacitylens-db` → the SQLite database at `/data/capacitylens.db` (+ its WAL sidecars).
- `capacitylens-backups` → timed online snapshots at `/backups`.

### Build-time vs runtime config (important)

CapacityLens splits its configuration in two:

- **Server runtime** (`CAPACITYLENS_*`, `BETTER_AUTH_*`, `PORT`, `NODE_ENV`) is read by the `api`
  daemon when it starts. Change `.env`, then `docker compose up -d` to apply.
- **Client build-time** (`VITE_CAPACITYLENS_*`) is **inlined into the SPA at build time** by
  Vite. Changing it needs a **rebuild**.

The one that bites people: **`VITE_CAPACITYLENS_API`** is the backend **origin** the browser
talks to (the client appends `/api` itself — so set the origin, **not** `/api`, or you'll get
requests to `/api/api/...`). It defaults to `http://localhost:8080`, which is correct for the
local quick start. To deploy on a real domain you must set it to your public origin **and
rebuild**, because Vite bakes it into the JS bundle:

```sh
# in .env
VITE_CAPACITYLENS_API=https://capacity.example.com

docker compose build      # re-inline the new origin into the SPA
docker compose up -d
```

A build that's missing/wrong here silently falls back to browser-local storage and otherwise
looks identical — confirm `· server` (not `· local`) in the build stamp at the bottom of
Settings after deploying.

---

## 3. Environment configuration

Every runtime variable the app and server actually read is enumerated in **`.env.example`**
with its default and meaning — that file is the source of truth (~26 vars). Don't restate all
of them here; copy it to `.env` and edit. The ones you should think about for a real deploy:

| Variable | When | What to set |
| --- | --- | --- |
| `WEB_PORT` | always | Host port for the SPA (default `8080`). |
| `VITE_CAPACITYLENS_API` | real domain | **Build-time.** The public origin, e.g. `https://capacity.example.com` (origin, not `/api`). Requires a rebuild. |
| `CAPACITYLENS_DB` | rarely | SQLite file path. In compose this is `/data/capacitylens.db` on the named volume — leave it. |
| `CAPACITYLENS_BACKUP_DIR` | recommended | Directory for timed snapshots (`/backups` in compose). Unset = backups OFF. See [§5](#5-backups--restore). |
| `CAPACITYLENS_HEALTH_DEEP` | recommended | `1` makes `/api/health` also do a real DB read (deep healthcheck). |
| `CAPACITYLENS_LOG` | recommended | `1` for structured per-request JSON logs (pino). |
| `CAPACITYLENS_RATE_LIMIT` | recommended | Requests/minute per IP across `/api/*` (default `300`; `/api/health` exempt). |
| `CAPACITYLENS_AUTH` | for auth | `off` (default) \| `password` \| `sso`. See [§4](#4-enabling-authentication). |
| `BETTER_AUTH_SECRET` | auth on | **Required** when auth is on. Session signing secret, **≥32 random chars**. Generate one: `openssl rand -base64 48`. |
| `BETTER_AUTH_URL` | auth on | **Required** when auth is on. The **public origin** the browser uses, e.g. `https://capacity.example.com`. |

Boolean flags are ON only when set to exactly `1`. **Never commit a real `.env`** — keep
secrets out of version control (the `.dockerignore` excludes `.env` from the image; the repo
`.gitignore` keeps it out of git).

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

If a required variable is missing, the `api` daemon **refuses to boot** with a clear message
(check `docker compose logs api`) rather than starting half-configured.

### 4a. `password` mode (email + password)

```sh
# in .env
CAPACITYLENS_AUTH=password
BETTER_AUTH_SECRET=<output of: openssl rand -base64 48>
BETTER_AUTH_URL=https://capacity.example.com
```

Then `docker compose up -d`. Better Auth creates its own tables (`user`, `session`, `account`,
`verification`) inside the **same** SQLite file on first boot.

> **Signup is invite-only by design — and `password` mode needs one manual step per new user.**
> Self-service public signup is intentionally **closed** (`CAPACITYLENS_ALLOW_OPEN_SIGNUP` unset):
> CapacityLens has no email infrastructure (no verification or password-reset mail), so opening signup
> on a shared instance is a footgun. Note that an **invite binds a role to an already-signed-in user**
> — it does not, by itself, create a login — so in `password` mode there is no self-serve path for a
> brand-new person to get in. Two options:
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

### 4b. `sso` mode — single OIDC/OAuth2 provider

`sso` mode wires **one** generic OAuth2/OIDC provider entirely from environment variables. You
point it at Google, Microsoft, GitHub, or any OIDC IdP — **one provider at a time**.

> **What this is / isn't (today):** there is **no** panel of native Google/Microsoft/GitHub
> social-login buttons yet — that multi-provider experience is **planned, not implemented**.
> Today you configure exactly **one** provider via the `CAPACITYLENS_SSO_*` variables below.

Common variables:

```sh
# in .env
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

After editing `.env`, apply with `docker compose up -d` and watch `docker compose logs -f api`
for the startup line (or a "refusing to start" message if something's missing).

---

## 5. Backups & restore

When `CAPACITYLENS_BACKUP_DIR` is set (it is `/backups` in compose), the `api` daemon writes
**WAL-safe online snapshots** of the SQLite database — once at boot, then every
`CAPACITYLENS_BACKUP_INTERVAL_MIN` minutes (default 60), keeping the newest
`CAPACITYLENS_BACKUP_KEEP` files (default 48, oldest pruned). With the defaults that's an
hourly snapshot and roughly a recovery-point objective of ≤ 1 hour. The live DB and its
snapshots live on separate named volumes (`capacitylens-db`, `capacitylens-backups`).

To copy a snapshot out of the volume to the host (e.g. to ship it off-box):

```sh
# list the snapshots inside the running api container
docker compose exec api ls -lt /backups

# copy a chosen snapshot from the container to your current directory
docker compose cp api:/backups/<snapshot-file>.db ./
```

> **Do not `cp` the live database file** while the daemon is running — it uses WAL mode, and a
> raw copy can be torn. Use the daemon's snapshots (above), which are taken WAL-safely.

**Restoring** a snapshot (stop the daemon, swap the file, clear stale WAL sidecars, restart) is
a procedure that should be **drilled**, not improvised. The exact, tested sequence lives in the
operations runbook — follow it rather than reinventing it:

→ **[`docs/runbook.md`](runbook.md) → "Restore"** for the step-by-step restore sequence.

(The runbook is written around the hosted demo's paths, but the restore **sequence** — stop,
copy the snapshot over the live DB, remove the `*.db-wal` / `*.db-shm` sidecars, restart,
verify — is identical for a Docker deploy; the equivalents are the `capacitylens-db` volume and
`docker compose stop api` / `start api`.)

---

## 6. Upgrades

```sh
# 1. take a fresh backup first (a snapshot you've verified you can restore)
docker compose exec api ls -lt /backups        # or trigger one by restarting api

# 2. pull the new code
git pull

# 3. rebuild the images and recreate the containers
docker compose build
docker compose up -d
```

Your data is on the named `capacitylens-db` volume, so a rebuild/recreate keeps it. If the
upgrade changes the data schema, the server migrates it in place on boot. If you deploy on a
real domain and the upgrade touches `VITE_CAPACITYLENS_API` (or you change it), remember the
SPA must be **rebuilt** for that to take effect (`docker compose build`).

**Always take and verify a backup before upgrading** — a backup you've never restored is a hope,
not a backup.

---

## 7. Troubleshooting / notes

- **Health check.** `GET /api/health` is unauthenticated and rate-limit-exempt. By default it
  returns `{ ok: true }` unconditionally; with `CAPACITYLENS_HEALTH_DEEP=1` it also does a
  trivial DB read and returns `{ ok: true, db: true, audit: 'ok' | 'degraded' }` (200) or
  `{ ok: false }` (503) if the DB is broken while the process is alive. (`audit` is a soft
  signal — a `'degraded'` audit stays a 200.) The container `HEALTHCHECK` already hits this
  endpoint.
- **Logs.** `docker compose logs -f api` for the daemon (with `CAPACITYLENS_LOG=1`, one JSON
  line per request plus hourly backup lines); `docker compose logs -f web` for nginx.
- **CORS.** The default topology is **same-origin** — the browser talks to nginx, which proxies
  `/api/*` to `api`, so no cross-origin request is ever made and CORS stays fail-closed. **Leave
  `CAPACITYLENS_CORS_ORIGIN` unset.** Only set it (to your API origin, or `*`) if you
  deliberately serve the SPA and the API on **different** origins.
- **"Refusing to start."** If `api` exits on boot, read the log line — the daemon fails loudly
  on misconfiguration (bad `CAPACITYLENS_AUTH` value, missing `BETTER_AUTH_SECRET` /
  `BETTER_AUTH_URL` with auth on, out-of-range `PORT`, etc.) instead of limping along.
- **`· local` instead of `· server`** in the Settings build stamp means the SPA was built
  without (or with the wrong) `VITE_CAPACITYLENS_API` and is using browser-local storage —
  fix the build arg and `docker compose build` (see [§2](#2-quick-start)).
- **Privacy posture.** No telemetry is emitted (the auth library's telemetry is explicitly
  disabled), there is no email infrastructure, and there are no third-party analytics. Your
  data stays in the SQLite file on your volume.

For deeper operational detail (deploy topology, monitoring, the production flag register) see
[`docs/production-plan.md`](production-plan.md), [`docs/runbook.md`](runbook.md), and
[`server/README.md`](../server/README.md).
