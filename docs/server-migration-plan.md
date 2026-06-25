# Plan of action — moving CapacityLens onto the database model

**Status of this doc:** forward-looking roadmap. Nothing here is started. The
*prep* it builds on (the server + the sync adapter) is already done — see below.

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

**Stage 0 = today:** the static localStorage deploy (`docs/deploy.md`). Each browser
is its own island, refresh-safe, no server. Everything below is the step *beyond* it.

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
- **Stay on `--experimental-sqlite`?** Production on an experimental Node flag is a
  known risk. Fine for a friends demo; revisit before anything real (see Stage B).

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

- **Build client-side conflict handling, THEN turn on the flag.**
  `CAPACITYLENS_OPTIMISTIC_CONCURRENCY=1` only makes the *server* return 409s; there is **no
  client conflict UI yet** (server README, "Status"). Flipping the flag without the UI
  just turns races into `persistError`/replay churn. So: build the 409-handling path
  in `ServerSyncAdapter` first, then enable the flag.
- **Move off `--experimental-sqlite`** to `better-sqlite3` / libSQL for a stable,
  non-experimental driver.
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
