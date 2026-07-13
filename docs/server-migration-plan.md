# Plan of action — moving CapacityLens onto the database model

> **STATUS: the near-term server move has SHIPPED** (server-backed default, same-origin
> `/api`, auth seam). This doc is retained for the still-conditional later stages (B–E); for
> present truth see [`DECISIONS.md`](../DECISIONS.md).

**Status of this doc:** the near-term move below is **done and shipped** (server-backed is now
the default build). The later stages (B–E) remain forward-looking roadmap — conditional, not
started. The *prep* it builds on (the server + the sync adapter) is also done — see below.

## Where we already are

The architectural groundwork is complete (see the `db-migration` memory and
`~/.claude/plans/at-some-stage-in-atomic-sundae.md`):

- **Phase 0 (done)** — pure, env-agnostic domain-core in `@capacitylens/shared`
  (`shared/src/domain/mutations.ts`): validation, integrity, cascade, import-remap.
- **Phase 1 (done)** — `server/` is a working Fastify + **raw `node:sqlite`** REST
  API (one table per entity, FK cascades mirror the store). The client
  `ServerSyncAdapter` (`src/data/ServerSyncAdapter.ts`) is a drop-in
  `PersistenceAdapter`: whole-tree read (`GET /api/state`), diffed per-entity writes.
  It's switched on by the **build-time** flag `VITE_CAPACITYLENS_API`
  (`src/data/storageAdapter.ts:19-21`).

So "moving to the DB model" is **not** a build — it's a **cutover plus hardening**.

**Stage 0 (was "today"):** the static localStorage deploy (`docs/deploy.md`) — each browser
its own island, refresh-safe, no server. This is **no longer the default**: server-backed is
now the shipped default build (an empty env = the same-origin SQLite `/api`), and the static
localStorage build is an explicit `VITE_CAPACITYLENS_DEMO=1` demo opt-in. The near-term move
described below is what shipped; the conditional stages beyond it follow.

---

## The one structural fact that frames everything

`VITE_CAPACITYLENS_API` is **inlined at build time** with **no localStorage fallback**.
A build either targets the server or it doesn't. Consequences the plan must respect:

- After cutover the **server is a hard dependency**. Server down ⇒ app down (unlike
  today's purely-local app).
- **Rollback = rebuild without the flag.** That returns the app to localStorage and
  **strands whatever's on the server** until re-imported. So rollback is not free —
  it's a data decision, not just a redeploy.
- On first boot the server **auto-seeds the demo accounts** (`seedIfUninitialized`).
  Decide up front: ship seeded, or start empty.

---

## Near-term: the move you actually want now (shared friends-demo, on the DB)

Goal: the four friends hit the same subdomain and share **one server-persisted
dataset** (no more per-browser islands), behind a simple gate. No real auth, no
per-account isolation — that's deliberate and matches today's "shared dataset,
last-writer-wins" posture, just durable on the server instead of in a browser.

This is a handful of ops steps on the existing Forge site — no app code required.

### Steps

1. **Persistent DB path.** Point the server at a stable file *outside* the deploy
   tree so `git pull`/rebuild never touches it:
   `CAPACITYLENS_DB=/home/forge/capacitylens-data/capacitylens.db`.
2. **Run the server as a Forge Daemon.** Command `npm start --workspace=server`,
   directory `/home/forge/<site>`, env `CAPACITYLENS_DB=…`, `PORT=8787`. Supervisor keeps
   it alive across crashes/reboots. **Add a daemon restart to the deploy script** so
   new code actually runs after a deploy.
3. **Reverse-proxy `/api` → `127.0.0.1:8787`** in the Nginx config. Same-origin, so
   CORS is moot (no `CAPACITYLENS_CORS_ORIGIN` needed).
4. **Flip the build onto the server.** Add to the deploy script *before*
   `npm run build`: `export VITE_CAPACITYLENS_API=https://<site>`.
5. **Gate it.** Nginx **HTTP Basic Auth** over the whole site — the API is fully
   destructive and unauthenticated; it must not be naked on the internet.
6. **Back it up.** It's one file: a `cron` `cp` to a timestamped copy (and/or
   DigitalOcean droplet snapshots). Snapshot *before* each demo so you can reset to
   a clean state in seconds.

### Decisions to make at cutover

- **Seed or start empty?** (see "one structural fact" above).
- **Preserve existing localStorage data?** If you or the friends have data in a
  browser you care about, export it and `POST /api/import` it **at cutover** — once
  the build flips, that local data is no longer what the app reads. If it's all
  throwaway demo data, skip this.
- **SQLite driver.** The server uses `node:sqlite` on Node 24, where it is **unflagged**
  (no `--experimental-sqlite`). Running on an unflagged, in-Node driver is a low risk; the
  pre-approved `better-sqlite3` fallback stays available if a regression appears (see Stage B).

### Gate (definition of done for the near-term move)

Run the existing **db-backed Playwright project** against the deployed-style config
(server + proxied `/api` + the flag-built front-end): create / edit / delete /
**reload** all survive a real round-trip; stop the daemon mid-session and confirm the
`persistError` banner appears and clears on restart; Basic Auth blocks an
unauthenticated request.

---

## Later stages — only if you outgrow the shared-demo model

These are **conditional**, not scheduled. Each is gated on a product trigger; don't
build ahead of the trigger.

### Stage B — Durability & concurrency hardening
*Trigger: the shared dataset starts mattering / multiple people edit at once.*

- **Completed:** client-side 409 handling now reloads authoritative state with an explicit conflict
  notice, and optimistic concurrency is enabled by default. Operators may set
  `CAPACITYLENS_OPTIMISTIC_CONCURRENCY=0` only as a deliberate compatibility escape hatch.
- **Driver swap, only if needed.** The server runs `node:sqlite` on Node 24 (unflagged);
  if a driver regression forces it, swap to `better-sqlite3` / libSQL.
- **Tested restore**, not just backups — prove a restore works.

### Stage C — Real auth + per-account isolation  *(the big one)*
*Trigger: real users, multiple trust domains who must not see each other's data.*

Today multi-tenancy is **UX, not security**: `accountId` is client-asserted, and
`ownsRow` is "defense-in-depth, not real isolation" (DECISIONS.md, server README).
Converting it to a security boundary is a genuine build:

- App-level login; derive `accountId` **from the session**, never from the client.
- Server-enforce per-account ownership on every read/write (`ownsRow` becomes real).
- Drop all client-asserted-account trust; add multi-tenant isolation tests + a
  security review as the gate.

This is what makes "anyone with the URL can wipe everything" no longer true. Until
it's done, the Basic Auth gate is the only thing standing between the API and the
internet — so **do not expose real, isolated-user data before Stage C.**

### Stage D — One-time "push my localStorage to the server" flow
*Trigger: real users with existing local data to carry over.*

Reuse the export path + `POST /api/import`. (For the near-term friends move this is
the manual cutover import in "Decisions" above; Stage D is the productised,
in-app version.)

### Stage E — Postgres
*Trigger: SQLite concurrency / managed-backup / scale needs justify the ops cost.*

Note: there is **no ORM seam** — `server/` uses raw `node:sqlite`. So this is a
**data-layer rewrite**, not a Drizzle dialect change (correcting the original plan's
assumption). Don't schedule it until a real constraint forces it.

---

## Recommended sequence

For the stated goal (friends demo, on the DB, pretty soon): **do the near-term move
only.** It's days of ops, reversible (modulo the data-strand caveat), and gives you
exactly what you asked for — no Ctrl-R islands, one shared dataset you control.

Treat B–E as a menu, pulled forward one at a time **only** when its trigger fires.
The dangerous mistake to avoid: exposing *real, isolated* user data on the
shared/no-auth model. That's the line where Stage C stops being optional.
