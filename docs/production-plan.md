# CapacityLens — Production plan (controlled demo, near-live)

**Status:** plan of record for the next user-testing round. Written 2026-06-12; upgraded
same day to hand-off-ready task specs (each task below is written so it can be given
verbatim to a coding model/agent and implemented without further product decisions).

> **NOTE (authoritative over the body):** sections below that specify Nginx Basic Auth are the
> original plan of record; per the 2026-06-16 update the alpha shipped with **NO auth gate** —
> treat Basic-Auth steps as historical unless re-adopted before beta. The dated task specs are
> left verbatim as the record of what was planned.

> **Update (2026-06-13):** the GitHub Actions CI workflow referenced below (the P1.1 task spec
> and the Phase 6 "pre-deploy" line) has since been **removed** to avoid Actions cost. The gate
> (`gate` + `gate:server` + `e2e`) now runs **locally** before pushing — there is no hosted CI by
> default. The task specs below are left unchanged as the dated record of what was done; see
> `docs/decisions-log.md`.

> **Update (2026-06-16) — Phase 2 cutover EXECUTED (alpha).** The move is live on
> DigitalOcean+Forge (`small-saas-agency-resource-alpha.kevinjohngallagher.com`): Node 24, the
> Fastify daemon as a Forge Background process (wrapper `/home/forge/capacitylens-data/run-server.sh`),
> the Nginx `/api` proxy, and the `VITE_CAPACITYLENS_API` build flip. Verified: `/api/health`
> {ok,db:true}, `/api/state` seeded, Settings `build … · server`. **Two owner divergences from
> the plan below:** (1) **no Basic Auth** and **no per-tester Accounts** — the round is SHARED +
> OPEN (just persist a shared dataset); (2) the deploy script keeps `NODE_ENV=development` for
> alpha. **Still open before beta:** flip to `NODE_ENV=production`, add an auth gate, and finish
> the Phase 2 edge hardening (steps 5–6 security headers + cache-control, and the droplet restore
> drill). Full runsheet: `docs/decisions-log.md` 2026-06-16; ops: `docs/runbook.md`.

**Goal (owner):** as close to live as possible *without requiring auth* — but with auth
wired in and switched off, so turning it on later (incl. SSO) is a config change plus
Stage C, not a re-architecture.

This builds on two existing docs and does not repeat them:
- [`docs/deploy.md`](deploy.md) — the static Forge/DigitalOcean deploy (Stage 0, done).
- [`docs/server-migration-plan.md`](server-migration-plan.md) — the near-term cutover
  (daemon + `/api` proxy + Basic Auth + persistent SQLite). **This plan executes that
  move**, hardened to near-live standards, and adds the auth seam.

**Posture (as deployed for alpha, 2026-06-16):** one shared server dataset, last-writer-wins,
multi-tenancy is UX not security — and, per the owner, **no auth gate this round** (the plan's
Basic Auth was dropped; add before beta). Stage C (real isolation) stays parked — see
"Deliberately not in this round" at the end.

## Ground rules for every task in this plan (owner, 2026-06-12)

1. **Every behavioural change ships behind an env flag, default OFF.** Unset flag ⇒
   byte-for-byte today's behaviour. This matches the existing fail-closed `CAPACITYLENS_*`
   posture (`CAPACITYLENS_ALLOW_RESET`, `CAPACITYLENS_CORS_ORIGIN`, `CAPACITYLENS_OPTIMISTIC_CONCURRENCY`).
   Server flags are runtime env (`CAPACITYLENS_*`); client flags are build-time Vite env
   (`VITE_CAPACITYLENS_*` — inlined at build, like `VITE_CAPACITYLENS_API`). The full register is
   below; three narrow exceptions are called out there with rationale.
2. **Each task is standalone** — own flag, own tests, own gate run. Land in any order
   within its phase.
3. **The implementer must respect `CLAUDE.md`'s invariants** (entity-extension path,
   scoped reads, REFERENCE.md-first for anything user-visible) and finish with
   `pnpm run gate` + `pnpm run gate:server` + `pnpm run e2e` green.
4. **Don't read `docs/decisions-log.md` whole** — append a one-line entry per landed
   task (tail-read only), per the standing logging process.

---

## Target architecture

```
Browser ──HTTPS──> Nginx (Forge site, Let's Encrypt, Basic Auth, security headers)
                     ├── /            → dist/ (Vite build, VITE_CAPACITYLENS_API baked in)
                     └── /api/*       → 127.0.0.1:8787  (Fastify daemon, node:sqlite)
                                          └── /home/forge/capacitylens-data/capacitylens.db (WAL)
                                                + online backups (CAPACITYLENS_BACKUP_DIR —
                                                  off by default, enabled on this host)
```

Same-origin `/api` proxy ⇒ CORS stays fail-closed (leave `CAPACITYLENS_CORS_ORIGIN` unset;
the localhost defaults never match a real origin).

---

## Phase 0 — Decisions and prerequisites (owner — DECIDED 2026-06-12)

All seven calls made by the owner on 2026-06-12; the task specs below already
incorporate them — an implementer does not need to re-ask any of these:

| # | Decision | Call (owner, 2026-06-12) |
|---|----------|--------------------------|
| 1 | **Seed or start empty** at cutover? | **Seeded + Cohesion import** — standard auto-seed, then `POST /api/import` the Cohesion Labs dataset from `_input/` so testers also see real-shaped agency data |
| 2 | **Preserve any existing browser data?** | **Throwaway — skip.** Nothing carried over; the build flip strands localStorage data by design |
| 3 | **Basic Auth credentials** | **Per-tester htpasswd entries** — attribution in Nginx access logs, per-person revocation |
| 4 | **One Account per tester?** | **Yes** — per-tester Accounts make last-writer-wins collisions rare by construction |
| 5 | **Node 24 LTS on the droplet?** | **Yes** — drop `--experimental-sqlite`; `better-sqlite3` is the fallback |
| 6 | **Client error reporting (Sentry)?** | **Skip this round** — server logs + build stamp + tester reports |
| 7 | **Auth library** | **Better Auth** (third-party OSS) instead of hand-rolled sessions + `openid-client` — owner prefers an open-source library where possible. Provider choice (Google/Microsoft/…) still deferred to when SSO is actually turned on; Better Auth's social providers / OIDC plugin make that config, not code |

Plus (also owner, 2026-06-12): **backups are configurable and OFF by default**
(`CAPACITYLENS_BACKUP_DIR`), and **every change in this plan is flagged OFF by default**
(see Ground rules).

Prerequisites (cheap, do regardless — see task P1.1):

- `.nvmrc` (`24`) at the root and `"engines": { "node": ">=24" }` in root +
  `server/package.json` — today nothing pins Node anywhere but CI.
- Confirm droplet disk headroom for DB + WAL + backups (KBs–MBs; the check sets the
  Phase 4 alert threshold).

---

## Flag register (single source of truth)

Every flag introduced by this plan. **Unset = OFF = exactly today's behaviour.**
"Set on droplet" is what Phase 2 configures for the demo deploy.

| Flag | Where | Default (unset) | ON means | Set on droplet |
|------|-------|-----------------|----------|----------------|
| `CAPACITYLENS_LOG=1` | server runtime | current logging (startup `console.log`, `console.error` on 500s) | Fastify pino logger: per-request method/path/status/latency JSON on stdout | `1` |
| `CAPACITYLENS_HEALTH_DEEP=1` | server runtime | `/api/health` → `{ ok: true }` unconditionally | `/api/health` also does a trivial DB read; `{ ok: true, db: true }`, or HTTP 503 `{ ok: false }` if the read throws | `1` |
| `CAPACITYLENS_RATE_LIMIT=<n>` | server runtime | no rate limiting | `@fastify/rate-limit`, `<n>` requests/min per IP on `/api/*`; `/api/health` exempt; non-numeric/`0` = off (fail-closed) | `300` |
| `CAPACITYLENS_BACKUP_DIR=<path>` | server runtime | no backups | periodic online snapshots into `<path>` (see P4.1) | `/home/forge/capacitylens-data/backups` |
| `CAPACITYLENS_BACKUP_INTERVAL_MIN=<n>` | server runtime | `60` (only read when backups on) | snapshot cadence in minutes | leave default |
| `CAPACITYLENS_BACKUP_KEEP=<n>` | server runtime | `48` (only read when backups on) | rolling retention count, oldest pruned | leave default |
| `CAPACITYLENS_AUTH=off\|password\|sso` | server runtime | `off` — no Better Auth init, no auth tables, no new routes except the thin `/api/auth/me`; every request passes with a synthetic demo identity | `password`/`sso`: Better Auth mounted at `/api/auth/*`, sessions required (401 otherwise) | leave `off` |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | server runtime | unused | required when `CAPACITYLENS_AUTH ≠ off` — boot refuses loudly if missing | not set |
| `VITE_CAPACITYLENS_BUILD_SHA=<sha>` | client build | Settings shows no build row (today's UI) | Settings shows `build <sha> · server\|local` | deploy script sets `$(git rev-parse --short HEAD)` |
| `VITE_CAPACITYLENS_FEEDBACK_MAILTO=<addr>` | client build | no feedback link (today's UI) | "Send feedback" mailto link in Settings | owner's address |

**Deliberate exceptions — changes that are NOT behind a flag** (each is a correctness/
safety fix where an "off" default would preserve the defect; flagging them was
considered and rejected):

1. **P1.1 Node 24 pinning / dropping `--experimental-sqlite`** — an environment
   prerequisite, not runtime behaviour. The "flag" is the Node version itself;
   rollback = revert the one-line script change.
2. **P1.2 graceful shutdown** — only changes what happens at process termination
   (today: requests can die mid-transaction). No steady-state behaviour change to
   gate; an off-default would keep the bug.
3. **P1.6 reset boot-guard** — a safety interlock on the *existing*
   `CAPACITYLENS_ALLOW_RESET` flag; it only activates when `NODE_ENV=production`, so dev
   and e2e behaviour is untouched. Defaulting a guard to off defeats it.

---

## Phase 1 — Server hardening in the repo (~1–1.5 days, lands behind the green gate)

Harden **before** the cutover so what first touches the internet is already production
shape. All repo work, all CI-testable. Each task below is a standalone hand-off.

### P1.1 — Node 24 + drop `--experimental-sqlite` *(no flag — exception 1)*
- **Decision:** Phase 0 #5. On Node 24, `node:sqlite` needs no flag.
- **Change:** add `.nvmrc` = `24` (root); add `"engines": { "node": ">=24" }` to
  `package.json` and `server/package.json`; remove `NODE_OPTIONS=--experimental-sqlite`
  from every `server/package.json` script; bump `.github/workflows/ci.yml`
  `node-version` to `24`.
- **Acceptance:** `pnpm run gate:server` green on Node 24 with no `ExperimentalWarning`
  in output; CI green.
- **Fallback (pre-approved):** if `node:sqlite` misbehaves on 24, swap the driver to
  `better-sqlite3` — the API surface is confined to `server/src/db.ts`.

### P1.2 — Graceful shutdown *(no flag — exception 2)*
- **Decision:** the Forge daemon restarts the process on every deploy; today that can
  kill a request mid-transaction.
- **Change:** in `server/src/index.ts`, on `SIGTERM`/`SIGINT`: `await app.close()`
  (Fastify stops accepting + drains in-flight requests), then `db.close()`, then
  `process.exit(0)`. Idempotent (second signal forces exit).
- **Tests:** unit test that the close hook runs in order (inject fakes); existing
  integration tests unchanged.
- **Acceptance:** `kill -TERM` on a dev run exits 0 cleanly; no behaviour change
  while running.

### P1.3 — Structured request logging · flag `CAPACITYLENS_LOG` (default OFF)
- **Decision:** plain `console.*` can't be filtered or parsed in production.
- **Change:** in `server/src/app.ts`, construct Fastify with
  `logger: env.CAPACITYLENS_LOG === '1'` (pino, default JSON to stdout). Route the existing
  500-path `console.error` through `req.log.error` when the logger is on (keep
  `console.error` when off — today's behaviour). No new dependency (pino ships with
  Fastify).
- **OFF behaviour:** identical to today (startup line + `console.error` on 500s).
- **Tests:** app factory unit test — flag on ⇒ `app.log` is a real logger and a
  request emits a completion log; flag off ⇒ logger disabled.

### P1.4 — Deep health check · flag `CAPACITYLENS_HEALTH_DEEP` (default OFF)
- **Decision:** `{ ok: true }` from a server whose DB is corrupt/locked is a lie to
  the uptime monitor.
- **Change:** in the `/api/health` handler: when flag is `'1'`, run a trivial read
  (`SELECT 1` prepared once, or the `_meta` lookup) inside try/catch → 200
  `{ ok: true, db: true }` or 503 `{ ok: false }`. When off, return today's
  `{ ok: true }` untouched (Playwright's `webServer` probe depends on it).
- **Tests:** flag on + healthy ⇒ `{ok,db}`; flag on + closed DB ⇒ 503; flag off ⇒
  exact current body.

### P1.5 — Rate limiting · flag `CAPACITYLENS_RATE_LIMIT` (default OFF)
- **Decision:** not a security control — a guard against accidental client loops
  hammering the single-writer SQLite file.
- **Change:** add `@fastify/rate-limit` (dev-approved dependency); register only when
  the flag parses to a positive integer `n` (`max: n`, `timeWindow: '1 minute'`,
  keyed by IP — trust `X-Forwarded-For` only when `CAPACITYLENS_HOST` is loopback, i.e.
  behind the Nginx proxy). Exempt `/api/health`. Non-numeric or `0` ⇒ off.
- **OFF behaviour:** plugin not registered at all.
- **Tests:** flag `=2` ⇒ third request inside a minute is 429 with a JSON error;
  `/api/health` never 429s; flag unset ⇒ no 429 under burst.

### P1.6 — Reset-route boot-guard *(no flag — exception 3)*
- **Decision:** `POST /api/test/reset` must be impossible in production, not merely
  unconfigured.
- **Change:** in `server/src/index.ts`, before listen: if
  `CAPACITYLENS_ALLOW_RESET === '1' && NODE_ENV === 'production'`, print one clear line and
  `process.exit(1)`.
- **Tests:** unit test the guard predicate (extract it); e2e/dev unaffected
  (`NODE_ENV` isn't `production` there).

### P1.7 — Build/mode stamp in Settings · flag `VITE_CAPACITYLENS_BUILD_SHA` (default OFF)
- **Decision:** testers must be able to report *which build*, and the smoke test must
  prove the deploy is actually in server mode (a build missing `VITE_CAPACITYLENS_API`
  silently reverts to localStorage and otherwise looks identical).
- **Change (client):** read `import.meta.env.VITE_CAPACITYLENS_BUILD_SHA` in a tiny helper
  next to `src/data/apiConfig.ts`. When set, `SettingsView` renders a muted one-line
  footer: `build <sha> · server` (when `isServerConfigured()`) or `build <sha> ·
  local`. When unset, render nothing — today's Settings exactly.
- **Process:** user-visible ⇒ update `user-stories/REFERENCE.md` (Settings section)
  first, then the affected `US-SET-*` story; add the row to the e2e settings spec
  (assert absent by default in the dev-built app, since the dev server won't set the
  var).
- **Tests:** unit test the helper + a SettingsView render test with the env stubbed
  both ways.

**Phase gate:** `pnpm run gate` + `pnpm run gate:server` + `pnpm run e2e` green; one
decisions-log line per landed task.

## Phase 2 — Cutover + edge hardening on Forge (~1 day, ops — no code, no flags)

This phase is operations on the Forge host; "flag OFF by default" is satisfied by the
fact that nothing here changes the repo — each step is an explicit host action with a
stated rollback. Execute `server-migration-plan.md` steps 1–6 as written, then layer
the items below. Order matters.

1. **Daemon + proxy + build flag** (migration plan steps 1–4): persistent
   `CAPACITYLENS_DB=/home/forge/capacitylens-data/capacitylens.db`; Forge daemon
   `pnpm --filter capacitylens-server start`; daemon restart added to the deploy script; Nginx
   `/api` → `127.0.0.1:8787`; `export VITE_CAPACITYLENS_API=https://<site>` in the deploy
   script *before* `pnpm run build`, plus
   `export VITE_CAPACITYLENS_BUILD_SHA=$(git rev-parse --short HEAD)` (P1.7).
   *Rollback:* remove the exports, redeploy (data-strand caveat — see runbook P4.5).
2. **Gate it** (migration plan step 5): Nginx Basic Auth over the whole site,
   **one htpasswd entry per tester** (Phase 0 #3). *Verify:* anonymous `GET /` and
   `GET /api/state` both 401.
3. **Seed + Cohesion import** (Phase 0 #1): first daemon boot auto-seeds; then
   `POST /api/import` the Cohesion Labs dataset from `_input/` into its own Account
   (the import endpoint takes `{ accountId, data }`; create the Account first via the
   UI or a PUT). *Verify:* the Cohesion company appears in the AccountPicker.
4. **Daemon env** (the droplet column of the flag register): `NODE_ENV=production`,
   `PORT=8787`, `CAPACITYLENS_DB` as above, `CAPACITYLENS_LOG=1`, `CAPACITYLENS_HEALTH_DEEP=1`,
   `CAPACITYLENS_RATE_LIMIT=300`, `CAPACITYLENS_BACKUP_DIR=/home/forge/capacitylens-data/backups`.
   Leave `CAPACITYLENS_HOST` at its `127.0.0.1` default (Nginx proxies on loopback); leave
   `CAPACITYLENS_CORS_ORIGIN`, `CAPACITYLENS_ALLOW_RESET`, `CAPACITYLENS_OPTIMISTIC_CONCURRENCY`, and
   `CAPACITYLENS_AUTH` unset.
5. **Security headers** in the Nginx site config (DECISIONS: CSP belongs in a host
   header, not the app):

   ```nginx
   add_header Strict-Transport-Security "max-age=31536000" always;
   add_header X-Content-Type-Options "nosniff" always;
   add_header Referrer-Policy "strict-origin-when-cross-origin" always;
   add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" always;
   ```

   (`style-src 'unsafe-inline'` is required — the scheduler positions bars with
   inline `style` attributes.) **Ship as `Content-Security-Policy-Report-Only`
   first** (the header's own off-by-default), click through the whole app watching
   the console, then switch to enforcing.
6. **Caching + compression:** `gzip on`; `location /assets/` →
   `Cache-Control: public, max-age=31536000, immutable` (Vite hashes filenames);
   `index.html` → `no-cache`. Without the second part testers get stuck on a stale
   build after a deploy.

## Phase 3 — Auth wired, switched OFF · flag `CAPACITYLENS_AUTH` (default `off`) (~1.5–2 days)

**Decision (Phase 0 #7):** Better Auth — third-party OSS — rather than hand-rolled
sessions + `openid-client`. It owns the session/credential/OIDC machinery; it is the
one new runtime dependency this round, accepted precisely to avoid owning crypto/
session code. Provider choice stays deferred; Better Auth's social providers / OIDC
plugin make that config, not code.

**The OFF guarantee (read first):** with `CAPACITYLENS_AUTH` unset or `off` —
- Better Auth is **not initialised**: no handler mounted, no auth tables created in
  the SQLite file, no `BETTER_AUTH_*` env read, zero new attack surface.
- The only new route is the thin `GET /api/auth/me` → `{ authMode: 'off', user:
  { id: 'demo', name: 'Demo' } }`.
- `requireUser` attaches that demo identity and continues — **no request that
  succeeds today may fail in off mode** (the e2e suite enforces this by running
  unchanged).
- The client never shows a login screen; in local mode (no `VITE_CAPACITYLENS_API`) the
  auth layer is a pass-through that performs **no fetch at all**.

### P3.1 — Server: Better Auth module (`server/src/auth.ts`, new)
- Parse `CAPACITYLENS_AUTH` (`off`|`password`|`sso`, anything else ⇒ refuse to boot,
  loudly — same posture as `assertSchemaCurrent`). Export `authMode`.
- When mode ≠ `off`: require `BETTER_AUTH_SECRET` + `BETTER_AUTH_URL` (boot refusal
  if missing); initialise Better Auth with email/password enabled in `password` mode
  and the social/OIDC plugin in `sso` mode; mount its handler under `/api/auth/*`
  via its Node integration.
- **Storage spike (do first, timebox ~1h):** Better Auth's own tables
  (user/session/account) live **in the same SQLite file**. Verify its `node:sqlite`
  support on Node 24; pre-approved fallback: `better-sqlite3` *for the auth tables
  only*. These tables are NOT AppData entities — the entity drift-proofing lists
  (KNOWN_KEYS / tables.ts / sanitize) deliberately do not cover them; add a comment
  saying so at the definition site.

### P3.2 — Server: gate + identity route
- One `preHandler` hook `requireUser` on everything under `/api/` **except**
  `/api/health` and `/api/auth/*`: `off` ⇒ attach the demo identity, continue;
  `password`/`sso` ⇒ 401 JSON without a valid Better Auth session.
- `GET /api/auth/me` (ours, thin; exists in **every** mode so the client never
  forks): `{ authMode, user }` — demo identity in `off`, Better Auth session user
  otherwise (401 when mode ≠ off and no session).

### P3.3 — Client: AuthProvider + LoginScreen (`src/auth/`, new)
- `AuthProvider`: if `!isServerConfigured()` ⇒ render children (no fetch — local
  mode untouched). Otherwise fetch `/api/auth/me` once at boot; `authMode: 'off'` ⇒
  render children; 401 ⇒ `LoginScreen`.
- `LoginScreen`: driven by Better Auth's React client (`createAuthClient` —
  `signIn.email`, `signIn.social`, `signOut`); shows the password form and/or
  "Continue with SSO" per the reported `authMode`. Sign-out appears in Settings only
  when `authMode ≠ off`.
- The server's reported `authMode` is the single source of truth — **no client-side
  auth flag exists**.
- User-visible ⇒ REFERENCE.md first, then a new `US-NAV-*` story (login screen),
  marked "flag-gated; not reachable in the default deploy".

### P3.4 — Client: sync adapter auth-awareness
- `ServerSyncAdapter`/`persist.ts`: send `credentials: 'include'` on every request;
  treat a 401 on a write like a load failure (existing `persistError` banner → the
  AuthProvider re-checks `/api/auth/me`), never a silent drop.
- **OFF behaviour:** `credentials: 'include'` on a same-origin request with no
  cookies set is a no-op — assert that in the db-backed e2e project (it must stay
  green untouched).

### P3.5 — Tests (per mode)
- Server: `off` ⇒ all existing app.test.ts routes pass unchanged AND `/api/auth/me`
  returns the demo identity; `password` ⇒ unauthenticated write 401 → sign-up/sign-in
  → 200; `sso` ⇒ `/api/auth/*` issues a provider redirect; bad `CAPACITYLENS_AUTH` value or
  missing secret ⇒ boot refusal.
- e2e: the whole suite keeps running in `off` mode (that *is* the off-guarantee
  test); one new spec for the `password` login screen against a dev server started
  with the flag on.

**Explicit non-goal, stated to keep Stage C honest:** this is *session/identity
plumbing only*. `accountId` stays client-asserted; per-account isolation is unchanged
(still defence-in-depth `ownsRow`). The session is exactly the seam where Stage C will
later derive `accountId` server-side — that's the point of building it now — but
wiring ≠ isolation, and this round's gate is still the Nginx Basic Auth.

## Phase 4 — Data safety + operations (~half a day)

### P4.1 — Backups · flag `CAPACITYLENS_BACKUP_DIR` (default OFF) — owner call 2026-06-12
- **Decision:** a small server feature, not a host cron; OFF by default, switched on
  per-host by env. WAL mode means a raw `cp` can catch a torn state ⇒ online
  snapshots only (this supersedes the migration plan's `cp` cron).
- **Change:** `server/src/backup.ts` (new). When `CAPACITYLENS_BACKUP_DIR` is set: ensure
  the dir exists; every `CAPACITYLENS_BACKUP_INTERVAL_MIN` minutes (default 60; `unref()`
  the timer) write `capacitylens-<YYYYMMDD-HHmmss-SSS>.db` via `node:sqlite`'s `backup()`
  (fallback `VACUUM INTO` if unavailable); prune to the newest `CAPACITYLENS_BACKUP_KEEP`
  (default 48). Take one snapshot immediately on start. Stop the timer in the P1.2
  shutdown path. Log one line per snapshot/prune (respects P1.3's flag).
- **OFF behaviour:** module never starts a timer, never touches the filesystem.
- **Tests:** temp dir + injected tiny interval ⇒ file appears and is a readable
  SQLite DB containing the seeded rows; retention prunes oldest; unset dir ⇒ no
  files, no timer.

### P4.2 — Restore drill (ops, once, before testers arrive)
Stop daemon → copy a snapshot over `CAPACITYLENS_DB` → start daemon → verify data in the
app. A backup that's never been restored is a hope, not a backup. Record the working
command sequence in the runbook (P4.5).

### P4.3 — Demo reset story (ops)
Snapshot before each testing session (the P4.1 files, or a manual
`sqlite3 … ".backup pre-session-<date>.db"`); restoring it is the
reset-to-clean-state button. This replaces any temptation to enable
`CAPACITYLENS_ALLOW_RESET` in production (which P1.6 makes impossible anyway).

### P4.4 — Monitoring (ops)
Uptime check (Forge monitor or UptimeRobot) on `https://<site>/api/health` *with
Basic Auth creds* + the SPA root; droplet disk alert sized against backup retention.
With `CAPACITYLENS_HEALTH_DEEP=1` (Phase 2) the probe actually exercises the DB.

### P4.5 — `docs/runbook.md` (new, one page)
Deploy, logs location, daemon restart, restore (P4.2's exact commands), demo reset,
flag register pointer, and **rollback**: rebuild without `VITE_CAPACITYLENS_API` returns
the app to localStorage but *strands server data* — export via `GET /api/state`
first. Rollback is a data decision, not just a redeploy.

## Phase 5 — User-testing round polish (~half a day)

1. **Per-tester Accounts** (Phase 0 #4) — ops/data, no code: create one Account per
   tester on the deployed server (plus the Cohesion Account from Phase 2). Collisions
   under last-writer-wins become rare by construction; the AccountPicker doubles as
   "who are you".
2. **Feedback affordance · flag `VITE_CAPACITYLENS_FEEDBACK_MAILTO` (default OFF):** when
   set, Settings renders a "Send feedback" `mailto:` link next to the P1.7 build
   stamp (so reports arrive as "build `a1b2c3d`: …"). Unset ⇒ nothing renders —
   today's UI. REFERENCE.md + story update, same as P1.7.
3. **Tester briefing note** (one paragraph, in the invite — ops): data is shared per
   Account and durable on the server; export JSON anytime as a personal copy; please
   use demo-ish data — names typed into a shared demo are visible to the other
   testers and to us. (That last line is the privacy story for this round; HTTPS +
   Basic Auth cover transport and access.)
4. **Mobile affordances — already landed (2026-06-12,** `60eb210`**):** nav icons,
   the collapsible icon rail (collapsed by default on small screens), and the
   portrait "Best in landscape" hint (DECISIONS.md "Light mobile affordances").
   These pre-date the flag rule and are device-global prefs rather than env flags —
   include a phone in the post-deploy smoke pass; testers will open the invite link
   on one.

## Phase 6 — Verification gate + launch checklist (~half a day)

**Pre-deploy (CI, already wired):** `gate` + `gate:server` + `e2e` green, including
the db-backed Playwright project.

**Production-shaped rehearsal (local):** build with `VITE_CAPACITYLENS_API` (+
`VITE_CAPACITYLENS_BUILD_SHA`) set, serve `dist/` behind a local proxy to the API **with
the droplet's flag set** (`CAPACITYLENS_LOG=1`, `CAPACITYLENS_HEALTH_DEEP=1`,
`CAPACITYLENS_RATE_LIMIT=300`, `CAPACITYLENS_BACKUP_DIR=<tmp>`), run the db-backed e2e specs
against it — this is the migration plan's gate, kept, now also exercising the flags
in their ON state.

**Post-deploy smoke (manual, on the droplet, ~15 min):**
- [ ] Settings shows `build <sha> · server` (proves both build vars were baked in)
- [ ] Create / edit / delete / **reload** all survive a round-trip
- [ ] Second browser sees the first browser's change after reload (shared dataset)
- [ ] Stop the daemon mid-session → `persistError` banner; restart → clears
- [ ] Unauthenticated request (no Basic Auth) is blocked, on `/` and on `/api/state`
- [ ] Cross-origin `fetch` to `/api/state` from another site is refused (CORS)
- [ ] CSP report-only shows no violations after a full click-through → enforce
- [ ] `GET /api/health` returns `{ ok, db }` (deep check live) and the uptime monitor is green; deliberately kill the daemon → alert fires + Forge restarts it
- [ ] A backup snapshot file exists in `CAPACITYLENS_BACKUP_DIR`; restore drill done once (P4.2)
- [ ] `CAPACITYLENS_ALLOW_RESET` and `CAPACITYLENS_AUTH` unset (and P1.6 would refuse the former anyway)
- [ ] Repeat the create/reload smoke on a phone (landscape) — rail + rotate hint behave per US-NAV-09

---

## Deliberately NOT in this round (respecting the standing posture)

- **Stage C — real auth-derived isolation.** The auth scaffold ships **off**; the gate
  is Basic Auth. Do not invite anyone outside the trusted tester group: anyone with
  the URL + creds can edit/wipe the shared dataset. That line moves only when Stage C
  lands.
- **Stage B — optimistic concurrency (subsequently completed).** The client now handles 409s and
  the server/Compose default is enabled. `CAPACITYLENS_OPTIMISTIC_CONCURRENCY=0` is an explicit
  compatibility opt-out, not the normal multi-user posture.
- **Postgres, Docker, multi-region.** The Forge daemon + SQLite file is the right
  size; Docker adds nothing on this host. Stage E stays parked.

  > **Update (2026-07-03) — Docker superseded.** Full Docker support has since shipped
  > (`Dockerfile`, `docker-compose.yml`, [`docs/self-hosting.md`](self-hosting.md)) as a
  > separate, parallel deployment path — this doesn't change the Forge droplet call above, which
  > is left verbatim as the record of what was decided for that host. Postgres and multi-region
  > remain out of scope for either path.
- **App-level signup, per-seat gating, mobile views.** Standing non-goals (light
  mobile affordances landed 2026-06-12 are the agreed exception — DECISIONS.md).

## Risks (accepted or mitigated)

| Risk | Standing |
|------|----------|
| Last-writer-wins clobber between testers | Mitigated: per-tester Accounts; watched via testing-round feedback |
| Destructive API behind Basic Auth only | Accepted for trusted testers; Stage C is the exit |
| Single droplet, single DB file | Accepted; daemon backups ON in prod (OFF by default elsewhere), RPO ≤ 1 h, tested restore |
| Build missing `VITE_CAPACITYLENS_API` silently reverts to localStorage | Mitigated: deploy script owns the export; smoke test asserts `server` in the build stamp |
| Rollback strands server data | Documented in runbook: export before rebuilding without the flag |
| `node:sqlite` driver regressions on Node 24 | Mitigated: P1.1 lands behind the full server gate; `better-sqlite3` fallback pre-approved |
| Better Auth lacks solid `node:sqlite` support | Mitigated: P3.1 storage spike first; `better-sqlite3` fallback for auth tables only, pre-approved |
| A flag accidentally ON in the wrong environment | Mitigated: every flag is opt-in (unset = today); the only host that sets any is the droplet (flag register column) |

## Sequence and effort

Phases land in order; 1 is repo work (can start immediately), 2 is ops, 3–5 stack on
top. Tasks within a phase are standalone and parallelisable.

| Phase | What | Effort |
|------:|------|--------|
| 0 | Decisions + Node pinning | done (owner, 2026-06-12) |
| 1 | Server hardening in-repo (P1.1–P1.7) | done (2026-06-12, e5b2262…0cdae13 — see decisions log) |
| 2 | Cutover + Nginx edge (ops runsheet) | 1 d |
| 3 | Auth wired, off (P3.1–P3.5) | done (2026-06-12, aa5f0e9…838eedb — see decisions log) |
| 4 | Backups, drill, monitoring, runbook (P4.1–P4.5) | done (2026-06-13, 76a53d4 + b442a4a; P4.2 drill re-run on the droplet pending) |
| 5 | Testing-round polish | done (2026-06-13, cc7abc4 + runbook; P5.1 accounts are post-deploy ops) |
| 6 | Rehearsal + smoke + launch | rehearsal done (2026-06-13, b442a4a — db-specs green vs production build + ON flags); post-deploy smoke runs on the droplet |

**Total ≈ 5–6 working days** — consistent with the ~2026-06-18 cutover intent
(NEEDS-INPUT, owner 2026-06-11), landing testers on it the following week.
