# floaty-server

SQLite-backed, entity-level REST API for Floaty — the optional database backend
behind the `PersistenceAdapter` seam. The default app still runs on `localStorage`;
this server is opt-in via the `VITE_FLOATY_API` env var on the web app.

It deliberately imports the **same** pure domain-core the client uses — the
`@floaty/shared` workspace package (`@floaty/shared/domain/mutations`,
`@floaty/shared/data/{migrate,seed,transfer}`, `@floaty/shared/types/entities`,
`@floaty/shared/lib/*`) — so server-side validation, integrity, cascade and import
rules are literally the client's code, not a re-implementation that can drift.

## Requirements

- Node 24+ (uses the built-in `node:sqlite`, which needs no flag on 24 —
  pinned by the root `.nvmrc` and `engines`).

## Run

Install from the **repo root** — this is an npm workspace, so the root install is
what links `@floaty/shared` into both the web app and this server:

```bash
npm install            # at the repo root, not inside server/
npm run dev --workspace=server   # http://localhost:8787, seeds a never-initialised DB on first boot
```

Point the web app at it (from the repo root):

```bash
VITE_FLOATY_API=http://localhost:8787 npm run dev
```

## Scripts

- `npm run dev` — watch-mode server (`floaty.db`).
- `npm start` — run the server once (no watch).
- `npm run start:e2e` — reset-enabled server on a throwaway DB (used by the
  `db-backed` Playwright project).
- `npm test` — type-check-free vitest run (API integration + shared-core tests).
- `npm run type-check` — `tsc --noEmit`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/state` | Whole `AppData` tree — backs the client's `loadAll()`. |
| GET | `/api/meta` | `{ hasData }` — backs `hasExisting()`. |
| GET | `/api/health` | Liveness probe (used by Playwright's `webServer`). |
| PUT | `/api/:entity/:id` | Idempotent upsert — the verb the sync adapter uses for create + update. |
| POST | `/api/:entity` | Create. |
| PATCH | `/api/:entity/:id` | Partial update. |
| DELETE | `/api/:entity/:id` | Idempotent delete (DB cascades mirror the store); optional `?accountId=…` scopes it to the owner (404 cross-account). |
| POST | `/api/batch` | `{ ops: [...] }` — one transaction of upserts/deletes in op order; **the write path the shipped sync adapter actually uses** (per-entity verbs above serve direct/manual use). |
| POST | `/api/import` | `{ accountId, data }` — reuses `remapAndValidateImport`. |
| POST | `/api/test/reset` | Wipe (+ optional reseed). Gated by `FLOATY_ALLOW_RESET=1`. |

`:entity` is an `AppData` key: `accounts`, `clients`, `disciplines`, `projects`,
`phases`, `resources`, `tasks`, `allocations`, `timeOff`.

## Validation

The server is the integrity boundary for direct API writes, not just the UI. Every
POST/PUT/PATCH/batch-op runs two shared-core layers (see `src/validate.ts`): `sanitizeWrite`
**requires a non-empty string `id` (400 otherwise — SQLite's `TEXT PRIMARY KEY` would happily
store NULL)** and repairs value-level fields (enums — incl. an account's `schedulingMode`,
`timezone` (IANA-checked) and `weekStartsOn` (0|1) — colour, hours, `workingDays`) exactly as
the import path does, then `validateWrite` enforces referential integrity + date ranges. So a
hand-crafted request can't persist a junk enum, non-hex colour, NaN/negative hours, a dangling
foreign key, or an unaddressable null-id row. PATCH is a true partial merge (body merged over
the stored row before validation), not a column-wise overwrite.

The table column specs (`src/tables.ts`) are compile-checked against the shared entity types,
and fully-populated fixtures from `@floaty/shared/data/fixtures` are round-tripped in the API
tests — a field added to the shared types but not to a column spec fails `gate:server` instead
of silently dropping on write.

**Tenant guard (`ownsRow`).** `accountId` is immutable: a PUT/PATCH that tries to re-home an
existing row to another account is refused with 409. A DELETE is scoped to its owner when the
caller supplies `?accountId=…` (the sync adapter sends it for every scoped delete) — a
cross-account target returns 404. This is **defense-in-depth**, not real isolation: the account
is client-asserted, not derived from a session, until app-level auth lands (see Status below).

## Env

- `FLOATY_DB` — SQLite path (default `floaty.db`; `:memory:` works).
- `PORT` — default `8787`.
- `FLOATY_HOST` — listen host. **Defaults to `127.0.0.1` (localhost-only)** so a dev/laptop
  run is not reachable from the LAN. Set it to `0.0.0.0` to deliberately expose the API on the
  network (container / LAN / deploy).
- `FLOATY_ALLOW_RESET` — `1` to expose `POST /api/test/reset` (dev/E2E only).
- `FLOATY_CORS_ORIGIN` — CORS allow-list, comma-separated, or `*` to allow any
  origin. **Defaults to the local Vite dev/e2e origins** so the API is not open to
  every site by default. Set it to your deployed app's origin in production.
- `FLOATY_OPTIMISTIC_CONCURRENCY` — `1` to reject a stale overwrite (a PUT whose
  `updatedAt` is older than the stored row) with HTTP 409 instead of last-writer-wins.

Production-hardening flags (all **default OFF** = exactly the behaviour above; the full
register with the droplet's values lives in `docs/production-plan.md`):

- `FLOATY_LOG` — `1` for structured per-request JSON logs (Fastify's bundled pino) and
  500-path errors through the request logger. Off = startup line + `console.error` only.
- `FLOATY_HEALTH_DEEP` — `1` makes `/api/health` prove a trivial DB read: 200
  `{ ok, db: true }` or 503 `{ ok: false }`. Off = unconditional `{ ok: true }`.
- `FLOATY_RATE_LIMIT` — requests/minute per IP across `/api/*` (positive integer;
  unset/`0`/non-numeric = off, fail-closed). `/api/health` is exempt.
- `FLOATY_BACKUP_DIR` — set to a directory to enable periodic online DB snapshots
  (`floaty-<YYYYMMDD-HHmmss>.db`, one at boot then hourly). Off = no timer, no writes.
  - `FLOATY_BACKUP_INTERVAL_MIN` — cadence in minutes (default `60`).
  - `FLOATY_BACKUP_KEEP` — rolling retention count (default `48`, oldest pruned).
- `FLOATY_AUTH` — `off`|`password`|`sso` (default `off`: Better Auth is never
  initialised — no auth tables, no `/api/auth/*` routes beyond the thin `/api/auth/me`,
  every request carries a synthetic demo identity). Any other value refuses to boot.
  When ≠ `off`:
  - `BETTER_AUTH_SECRET` (32+ chars) and `BETTER_AUTH_URL` — required; boot refuses
    loudly if missing.
  - `FLOATY_SSO_*` (sso mode only) — `CLIENT_ID` + `CLIENT_SECRET`, plus
    `DISCOVERY_URL` or `AUTHORIZATION_URL` + `TOKEN_URL` (optional `PROVIDER_ID`,
    `SCOPES`). Provider choice is config, not code.

## Status / standing posture

Auth is **wired but OFF** (`FLOATY_AUTH`, Better Auth): sessions/login exist behind the
flag, but the demo gate stays Nginx Basic Auth and the dataset is shared. `ownsRow` is
defense-in-depth, not isolation — the account stays client-asserted until Stage C derives
it from the session. Optimistic concurrency stays off (last-writer-wins) until a client
conflict UI exists. Postgres and real per-account ownership remain deferred (see
`docs/production-plan.md` and `docs/runbook.md` for the deploy/ops side).
