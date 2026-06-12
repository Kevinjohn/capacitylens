# Floaty — Production plan (controlled demo, near-live)

**Status:** plan of record for the next user-testing round, written 2026-06-12.
**Goal (owner):** as close to live as possible *without requiring auth* — but with auth
wired in and switched off, so turning it on later (incl. SSO) is a config change plus
Stage C, not a re-architecture.

This builds on two existing docs and does not repeat them:
- [`docs/deploy.md`](deploy.md) — the static Forge/DigitalOcean deploy (Stage 0, done).
- [`docs/server-migration-plan.md`](server-migration-plan.md) — the near-term cutover
  (daemon + `/api` proxy + Basic Auth + persistent SQLite). **This plan executes that
  move**, hardened to near-live standards, and adds the auth seam.

**Posture stays:** one shared server dataset, last-writer-wins, Basic Auth as the gate,
multi-tenancy is UX not security. Stage C (real isolation) stays parked — see
"Deliberately not in this round" at the end.

---

## Target architecture

```
Browser ──HTTPS──> Nginx (Forge site, Let's Encrypt, Basic Auth, security headers)
                     ├── /            → dist/ (Vite build, VITE_FLOATY_API baked in)
                     └── /api/*       → 127.0.0.1:8787  (Fastify daemon, node:sqlite)
                                          └── /home/forge/floaty-data/floaty.db (WAL)
                                                + online backups (FLOATY_BACKUP_DIR —
                                                  off by default, enabled on this host)
```

Same-origin `/api` proxy ⇒ CORS stays fail-closed (leave `FLOATY_CORS_ORIGIN` unset;
the localhost defaults never match a real origin).

---

## Phase 0 — Decisions and prerequisites (owner — DECIDED 2026-06-12)

All seven calls made by the owner on 2026-06-12; later phases reflect them:

| # | Decision | Call (owner, 2026-06-12) |
|---|----------|--------------------------|
| 1 | **Seed or start empty** at cutover? | **Seeded + Cohesion import** — standard auto-seed, then `POST /api/import` the Cohesion Labs dataset from `_input/` so testers also see real-shaped agency data |
| 2 | **Preserve any existing browser data?** | **Throwaway — skip.** Nothing carried over; the build flip strands localStorage data by design |
| 3 | **Basic Auth credentials** | **Per-tester htpasswd entries** — attribution in Nginx access logs, per-person revocation |
| 4 | **One Account per tester?** | **Yes** — per-tester Accounts make last-writer-wins collisions rare by construction |
| 5 | **Node 24 LTS on the droplet?** | **Yes** — drop `--experimental-sqlite`; `better-sqlite3` is the fallback |
| 6 | **Client error reporting (Sentry)?** | **Skip this round** — server logs + build stamp + tester reports |
| 7 | **Auth library** | **Better Auth** (third-party OSS) instead of hand-rolled sessions + `openid-client` — owner prefers an open-source library where possible. Provider choice (Google/Microsoft/…) still deferred to when SSO is actually turned on; Better Auth's social providers / OIDC plugin make that config, not code |

Prerequisites (cheap, do regardless):

- Add `.nvmrc` (`24`) at the root and `"engines": { "node": ">=24" }` to root +
  `server/package.json` — today nothing pins Node anywhere but CI.
- Confirm droplet disk headroom for DB + WAL + 14 days of backups (it's KBs–MBs; the
  check is for the *alerting* threshold, Phase 4).

---

## Phase 1 — Server hardening in the repo (~1–1.5 days, lands behind the green gate)

Harden **before** the cutover so what first touches the internet is already production
shape. All of this is testable locally and in CI.

1. **Drop `--experimental-sqlite`.** On Node 24, `node:sqlite` needs no flag. Remove
   `NODE_OPTIONS` from `server/package.json` scripts and CI; pin Node per Phase 0.
   Fallback if anything misbehaves: swap to `better-sqlite3` (API surface used is
   small — `db.ts` only).
2. **Graceful shutdown** (`server/src/index.ts`): `SIGTERM`/`SIGINT` →
   `await app.close()` → `db.close()`. The Forge daemon restarts the process on every
   deploy; today that can kill a request mid-transaction.
3. **Structured request logging:** enable Fastify's built-in pino
   (`fastify({ logger: true })`) — method/path/status/latency per request, JSON to
   stdout (the daemon captures it). Replaces the bare `console.log/error`.
4. **Deep health check:** `/api/health` should run a trivial DB read (`SELECT 1` /
   meta lookup) and return `{ ok, db: true }` — today it returns `{ ok: true }`
   unconditionally, so a corrupted/locked DB still looks healthy to monitoring.
5. **Rate limiting:** `@fastify/rate-limit`, ~300 req/min per IP, `/api/health`
   exempt. Not a security control — a guard against accidental client loops hammering
   the single-writer SQLite file.
6. **Reset-route belt-and-braces:** refuse to boot with `FLOATY_ALLOW_RESET=1` when
   `NODE_ENV=production` (or when `FLOATY_DB` isn't a throwaway path). One `if` in
   `index.ts`; turns a checklist item into an impossibility.
7. **Build/mode stamp:** inject the git sha at build time (Vite `define` →
   `__APP_VERSION__`) and show `build <sha> · server|local` in Settings. Testers can
   report which build; **the smoke test can assert the deploy is actually in server
   mode** — a build that silently misses `VITE_FLOATY_API` reverts to localStorage and
   otherwise looks identical.

Gate: `npm run gate` + `npm run gate:server` + `npm run e2e` green; new unit tests for
shutdown/health/reset-guard behaviours.

## Phase 2 — Cutover + edge hardening on Forge (~1 day, ops)

Execute `server-migration-plan.md` steps 1–6 as written (persistent
`FLOATY_DB=/home/forge/floaty-data/floaty.db`, daemon `npm start --workspace=server`,
daemon restart in the deploy script, `/api` proxy, `export VITE_FLOATY_API=https://<site>`
before `npm run build`, Basic Auth — Phase 4 replaces that plan's backup cron with the
daemon's configurable backups). Per Decision 1, after first boot seeds the demo
accounts, `POST /api/import` the Cohesion Labs dataset from `_input/` into its own
Account. On top of it, in the Nginx config:

1. **Security headers** (DECISIONS already says CSP belongs in a host header):

   ```nginx
   add_header Strict-Transport-Security "max-age=31536000" always;
   add_header X-Content-Type-Options "nosniff" always;
   add_header Referrer-Policy "strict-origin-when-cross-origin" always;
   add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" always;
   ```

   (`style-src 'unsafe-inline'` is required — the scheduler positions bars with inline
   `style` attributes.) Ship it as `Content-Security-Policy-Report-Only` for the first
   deploy, click through the whole app watching the console, then enforce.
2. **Caching + compression:** `gzip on`; `/assets/` → `Cache-Control: public,
   max-age=31536000, immutable` (Vite hashes filenames); `index.html` → `no-cache`.
   Without the second part, testers can be stuck on a stale build after a deploy.
3. **Env on the daemon:** `FLOATY_DB`, `PORT=8787`, `NODE_ENV=production`, plus
   `FLOATY_BACKUP_DIR=/home/forge/floaty-data/backups` to switch backups ON for this
   host (Phase 4 — they're off by default). Leave `FLOATY_HOST` at its `127.0.0.1`
   default (Nginx proxies on loopback), leave `FLOATY_CORS_ORIGIN` unset
   (same-origin), leave `FLOATY_ALLOW_RESET` and `FLOATY_OPTIMISTIC_CONCURRENCY`
   unset.

## Phase 3 — Auth wired, switched off (~1.5–2 days)

The owner ask: the app must not *require* auth for this round, but the wiring should
exist so SSO is a switch, not a build. **Owner call (2026-06-12, Decision 7): use
Better Auth** — a third-party open-source TypeScript auth library — rather than
hand-rolling sessions + `openid-client`. It owns the session/credential/OIDC
machinery we'd otherwise maintain; it is the one new runtime dependency this round
(the repo is otherwise deliberately lean), accepted precisely to avoid owning
crypto/session code.

**One mode switch, ours.** `FLOATY_AUTH = off | password | sso`, default `off`.
Better Auth supplies sessions, sign-in flows and providers; the mode switch and the
gate stay one `preHandler` we own.

**Server** (`server/src/auth.ts`, new):
- Mount Better Auth's handler under `/api/auth/*` (it ships Node server
  integrations); email/password is built in, and social sign-on (Google, Microsoft,
  GitHub, …) plus a generic-OIDC plugin cover SSO later — provider choice stays
  config, not code.
- Storage: Better Auth manages its own tables (user/session/account) **in the same
  SQLite file**. Verify its `node:sqlite` support on the Node 24 setup during the
  spike; fallback is `better-sqlite3` *for the auth tables only*. These tables are
  NOT AppData entities — the entity drift-proofing lists deliberately don't cover
  them.
- One `preHandler` hook, `requireUser`, on everything under `/api/` **except**
  `/api/health` and `/api/auth/*`:
  - `off` → attaches a synthetic demo identity and continues (zero behaviour change);
  - `password` / `sso` → 401 without a valid Better Auth session.
- `GET /api/auth/me` (ours, thin — exists in every mode so the client code path
  never forks): returns `{ authMode, user }` — the demo identity in `off` mode, the
  Better Auth session user otherwise.
- Env: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, plus provider credentials only when
  SSO is turned on.

**Client:**
- `AuthProvider` (new, `src/auth/`): when `isServerConfigured()`, fetch
  `/api/auth/me` at boot. `off` → resolves instantly, testers never see anything.
  401 → `LoginScreen` driven by Better Auth's React client (`createAuthClient` —
  `signIn.email`, `signIn.social`, `signOut`), showing password and/or "Continue
  with SSO" depending on the reported `authMode`. Sign-out appears in Settings only
  when `authMode ≠ off`.
- `ServerSyncAdapter`: send `credentials: 'include'`; treat a 401 on a write like a
  load failure (banner → re-auth), not a silent drop.

**Explicit non-goal, stated to keep Stage C honest:** this is *session/identity
plumbing only*. `accountId` stays client-asserted; per-account isolation is unchanged
(still defence-in-depth `ownsRow`). The session is exactly the seam where Stage C will
later derive `accountId` server-side — that's the point of building it now — but
wiring ≠ isolation, and this round's gate is still the Nginx Basic Auth.

**Tests:** server unit tests per mode (`off` passes through; `password` 401 →
sign-in → 200; `sso` issues a provider redirect); e2e keeps running in `off` mode;
one e2e smoke for the `password` login screen behind a flag-built dev server.

## Phase 4 — Data safety + operations (~half a day)

1. **Backups — configurable, OFF by default** (owner call, 2026-06-12). A small
   server feature (lands behind the gate like Phase 1 work), not a host cron: the
   daemon takes online snapshots itself via `node:sqlite`'s `backup()` (Node ≥ 23.8;
   `VACUUM INTO` is the fallback). WAL mode means a raw `cp` can catch a torn state —
   that's why it's an online backup, and why the migration plan's `cp` cron is
   superseded. Config, matching the fail-closed `FLOATY_*` posture:
   - `FLOATY_BACKUP_DIR` — **unset (default) = backups off**; set = enabled,
     timestamped snapshot files written there.
   - `FLOATY_BACKUP_INTERVAL_MIN` — default `60` when enabled.
   - `FLOATY_BACKUP_KEEP` — rolling retention count, default `48` (~2 days hourly).
   **Enable it on the droplet** (Phase 2 env): RPO ≤ 1 hour, accepted for a
   controlled demo. Dev/laptop runs stay backup-free by default.
2. **One restore drill, now** — stop daemon, restore a backup over the live file,
   restart, verify. A backup that's never been restored is a hope, not a backup.
3. **Demo reset story:** snapshot before each testing session
   (`sqlite3 … ".backup pre-session-<date>.db"`); restoring it is the
   reset-to-clean-state button. This replaces any temptation to enable
   `FLOATY_ALLOW_RESET` in production.
4. **Monitoring:** uptime check (Forge monitor or UptimeRobot) on
   `https://<site>/api/health` *with Basic Auth creds* + the SPA root; droplet disk
   alert. The daemon itself is supervised by Forge already.
5. **`docs/runbook.md`** (new, one page): deploy, logs location, daemon restart,
   restore, demo reset, and **rollback** — rebuild without `VITE_FLOATY_API` returns
   the app to localStorage but *strands server data*; export via `GET /api/state`
   first. Rollback is a data decision, not just a redeploy.

## Phase 5 — User-testing round polish (~half a day)

1. **Per-tester Accounts** (Phase 0 #4): create one Account per tester in the seeded
   data. Collisions under last-writer-wins become rare by construction; the
   AccountPicker doubles as "who are you".
2. **Feedback affordance:** a `mailto:` link + the build stamp in Settings — testers
   can report "build `a1b2c3d`, here's what happened" with zero infrastructure.
3. **Tester briefing note** (one paragraph, in the invite): data is shared per
   Account and durable on the server; export JSON anytime as a personal copy; please
   use demo-ish data — names typed into a shared demo are visible to the other
   testers and to us. (That last line is the privacy story for this round; HTTPS +
   Basic Auth cover transport and access.)
4. **Update `user-stories/REFERENCE.md`** for anything Phases 1/3 made visible
   (build stamp, Settings additions), then the affected stories — per the standing
   process.
5. **Mobile affordances — already landed (2026-06-12):** nav icons, the collapsible
   icon rail (collapsed by default on small screens), and the portrait "Best in
   landscape" hint (see DECISIONS.md "Light mobile affordances"). Include a phone in
   the post-deploy smoke pass — testers will open the invite link on one.

## Phase 6 — Verification gate + launch checklist (~half a day)

**Pre-deploy (CI, already wired):** `gate` + `gate:server` + `e2e` green, including
the db-backed Playwright project.

**Production-shaped rehearsal (local):** build with `VITE_FLOATY_API` set, serve
`dist/` behind a local proxy to the API, run the db-backed e2e specs against it —
this is the migration plan's gate, kept.

**Post-deploy smoke (manual, on the droplet, ~15 min):**
- [ ] Settings shows `build <sha> · server` (proves the flag was baked in)
- [ ] Create / edit / delete / **reload** all survive a round-trip
- [ ] Second browser sees the first browser's change after reload (shared dataset)
- [ ] Stop the daemon mid-session → `persistError` banner; restart → clears
- [ ] Unauthenticated request (no Basic Auth) is blocked, on `/` and on `/api/state`
- [ ] Cross-origin `fetch` to `/api/state` from another site is refused (CORS)
- [ ] CSP report-only shows no violations after a full click-through → enforce
- [ ] Backups enabled on the daemon (`FLOATY_BACKUP_DIR` set) and a snapshot file produced; restore drill done once
- [ ] Uptime monitor green; deliberately kill the daemon and confirm it alerts + Forge restarts it
- [ ] `FLOATY_ALLOW_RESET` unset (and the Phase 1 guard refuses it anyway)

---

## Deliberately NOT in this round (respecting the standing posture)

- **Stage C — real auth-derived isolation.** The auth scaffold ships **off**; the gate
  is Basic Auth. Do not invite anyone outside the trusted tester group: anyone with
  the URL + creds can edit/wipe the shared dataset. That line moves only when Stage C
  lands.
- **Stage B — optimistic concurrency.** Leave `FLOATY_OPTIMISTIC_CONCURRENCY` off:
  flipping it without a client 409/conflict UI just turns races into error churn
  (per the migration plan). Per-tester Accounts are this round's mitigation. If the
  test script deliberately has people co-editing one Account, build the client 409
  path first — that's the trigger firing.
- **Postgres, Docker, multi-region.** The Forge daemon + SQLite file is the right
  size; Docker adds nothing on this host. Stage E stays parked.
- **App-level signup, per-seat gating, mobile.** Standing non-goals.

## Risks (accepted or mitigated)

| Risk | Standing |
|------|----------|
| Last-writer-wins clobber between testers | Mitigated: per-tester Accounts; watched via testing-round feedback |
| Destructive API behind Basic Auth only | Accepted for trusted testers; Stage C is the exit |
| Single droplet, single DB file | Accepted; daemon backups enabled in prod (off by default elsewhere), RPO ≤ 1 h, tested restore |
| Build missing `VITE_FLOATY_API` silently reverts to localStorage | Mitigated: deploy script owns the export; smoke test asserts `server` in the build stamp |
| Rollback strands server data | Documented in runbook: export before rebuilding without the flag |
| `node:sqlite` driver regressions on Node 24 | Mitigated: flag removed behind the full server gate; `better-sqlite3` fallback identified |

## Sequence and effort

Phases land in order; 1 is repo work (can start immediately), 2 is ops, 3–5 stack on top.

| Phase | What | Effort |
|------:|------|--------|
| 0 | Decisions + Node pinning | 0.5 d (owner) |
| 1 | Server hardening in-repo | 1–1.5 d |
| 2 | Cutover + Nginx edge | 1 d |
| 3 | Auth wired, off | 1.5–2 d |
| 4 | Backups, monitoring, runbook | 0.5 d |
| 5 | Testing-round polish | 0.5 d |
| 6 | Rehearsal + smoke + launch | 0.5 d |

**Total ≈ 5–6 working days** — consistent with the ~2026-06-18 cutover intent
(NEEDS-INPUT, owner 2026-06-11), landing testers on it the following week.
