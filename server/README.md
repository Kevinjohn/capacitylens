# capacitylens-server

SQLite-backed, entity-level REST API for CapacityLens — the **default** database backend
behind the `PersistenceAdapter` seam. This is what `npm run dev` (at the repo root) now starts
alongside the web app, and what an unconfigured build talks to over a same-origin `/api`. (The
in-browser `localStorage` build is the explicit opt-in — a `VITE_CAPACITYLENS_DEMO=1` demo
preview.) `VITE_CAPACITYLENS_API` on the web app only **overrides the backend origin** (e.g. point
it at a remote API) — it does not turn the server on, since the server is already the default. So a
deploy with **no** same-origin `/api` backend (a static host with no API) must instead build the
demo (`VITE_CAPACITYLENS_DEMO=1`) — a backend-less server build boots into a "can't reach the server"
screen.

It deliberately imports the **same** pure domain-core the client uses — the
`@capacitylens/shared` workspace package (`@capacitylens/shared/domain/mutations`,
`@capacitylens/shared/data/{migrate,seed,transfer}`, `@capacitylens/shared/types/entities`,
`@capacitylens/shared/lib/*`) — so server-side validation, integrity, cascade and import
rules are literally the client's code, not a re-implementation that can drift.

## Requirements

- Node 24+ (uses the built-in `node:sqlite`, which needs no flag on 24 —
  pinned by the root `.nvmrc` and `engines`).

## Run

The usual path is **`npm run dev` at the repo root**, which starts this API on `:8787` *and* the Vite
web app together (wiring a same-origin `/api` proxy) — you don't run the server by hand for normal
full-stack dev. The standalone instructions below are for running **just** the API (e.g. against a
separately served front end, or for poking the endpoints directly).

Install from the **repo root** — this is an npm workspace, so the root install is
what links `@capacitylens/shared` into both the web app and this server:

```bash
npm install            # at the repo root, not inside server/
npm run dev --workspace=server   # http://localhost:8787, starts EMPTY unless CAPACITYLENS_SEED_DEMO=1
```

To point a Vite-only web app (`npm run dev:web`, run separately) at a standalone API on a non-default
origin, set the override (from the repo root):

```bash
VITE_CAPACITYLENS_API=http://localhost:8787 npm run dev:web
```

## Scripts

- `npm run dev` (in `server/`, i.e. `--workspace=server`) — watch-mode API only
  (`capacitylens.db`); the repo-root `npm run dev` is the full-stack launcher (see above).
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
| POST | `/api/test/reset` | Wipe (+ optional reseed). Gated by `CAPACITYLENS_ALLOW_RESET=1`. |

`:entity` is an `AppData` key: `accounts`, `clients`, `disciplines`, `projects`,
`phases`, `resources`, `activities`, `allocations`, `timeOff`.

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
and fully-populated fixtures from `@capacitylens/shared/data/fixtures` are round-tripped in the API
tests — a field added to the shared types but not to a column spec fails `gate:server` instead
of silently dropping on write.

**Tenant guard (`ownsRow`).** `accountId` is immutable: a PUT/PATCH that tries to re-home an
existing row to another account is refused with 409. A DELETE is scoped to its owner when the
caller supplies `?accountId=…` (the sync adapter sends it for every scoped delete) — a
cross-account target returns 404. This is **defense-in-depth**, not real isolation: the account
is client-asserted, not derived from a session, until app-level auth lands (see Status below).

## Env

- `CAPACITYLENS_DB` — SQLite path (default `capacitylens.db`; `:memory:` works).
- `PORT` — default `8787`.
- `CAPACITYLENS_HOST` — listen host. **Defaults to `127.0.0.1` (localhost-only)** so a dev/laptop
  run is not reachable from the LAN. Set it to `0.0.0.0` to deliberately expose the API on the
  network (container / LAN / deploy).
- `CAPACITYLENS_ALLOW_RESET` — `1` to expose `POST /api/test/reset` (dev/E2E only).
- `CAPACITYLENS_CORS_ORIGIN` — CORS allow-list, comma-separated, or `*` to allow any
  origin. **Defaults to the local Vite dev/e2e origins** so the API is not open to
  every site by default. Set it to your deployed app's origin in production.
- `CAPACITYLENS_OPTIMISTIC_CONCURRENCY` — `1` to reject a stale overwrite (a PUT whose
  `updatedAt` is older than the stored row) with HTTP 409 instead of last-writer-wins.

Production-hardening flags (all **default OFF** = exactly the behaviour above; the full
register with the droplet's values lives in `docs/production-plan.md`):

- `CAPACITYLENS_LOG` — `1` for structured per-request JSON logs (Fastify's bundled pino) and
  500-path errors through the request logger. Off = startup line + `console.error` only.
- `CAPACITYLENS_HEALTH_DEEP` — `1` makes `/api/health` prove a trivial DB read: 200
  `{ ok, db: true }` or 503 `{ ok: false }`. Off = unconditional `{ ok: true }`.
- `CAPACITYLENS_RATE_LIMIT` — requests/minute per IP across `/api/*` (positive integer;
  unset/`0`/non-numeric = off, fail-closed). `/api/health` is exempt.
- `CAPACITYLENS_BACKUP_DIR` — set to a directory to enable periodic online DB snapshots
  (`capacitylens-<YYYYMMDD-HHmmss>.db`, one at boot then hourly). Off = no timer, no writes.
  - `CAPACITYLENS_BACKUP_INTERVAL_MIN` — cadence in minutes (default `60`).
  - `CAPACITYLENS_BACKUP_KEEP` — rolling retention count (default `48`, oldest pruned).
- `CAPACITYLENS_HTTPS` — `1` when the public origin is real HTTPS: enables the HSTS header. Off
  (default) is correct when TLS terminates at a reverse proxy (nginx/Forge) in front of plain
  HTTP — HSTS over plain HTTP is invalid/harmful. The other baseline security headers (nosniff,
  CSP, Referrer-Policy, X-Frame-Options) are always on regardless of this flag.
- `CAPACITYLENS_BOOTSTRAP_TOKEN` — shared secret enabling constrained org-creation via
  `POST /api/orgs` (sent as the `x-capacitylens-bootstrap-token` header) for a caller who isn't
  yet an Owner/Admin of any account. Off by default (unset/empty = the token path never allows
  — org-creation is then first-run-only, i.e. zero accounts, or an existing Owner/Admin). NOTE:
  the token now presumes a multi-account instance — it only matters once
  `CAPACITYLENS_MULTI_ACCOUNT` (below) is also on, since the single-company cap denies every
  create, token or not, while the instance is capped to one company.
- `CAPACITYLENS_MULTI_ACCOUNT` — `1` to allow more than one company (`accounts` row) on this
  instance. **Default off: CapacityLens is single-company-per-instance** — once the `accounts`
  table holds one row, every create-a-company vector (`POST /api/accounts`, `POST /api/orgs`, a
  create-shaped PUT/batch-PUT) 403s with `This instance allows a single company. Set
  CAPACITYLENS_MULTI_ACCOUNT=1 to allow more.`, in EVERY auth mode including `off`. Enforcement is
  create-time only — an existing DB with several companies (e.g. seeded before the cap existed)
  keeps working either way; update/delete of an existing account is never affected.
- `CAPACITYLENS_SEED_DEMO` — `1` to seed the two-company demo dataset (Studio North + Loft
  Digital) on a never-initialised DB at boot. **Default off: a fresh server now starts EMPTY** —
  the first-run experience is creating your one company at the account picker. Only makes sense
  paired with `CAPACITYLENS_MULTI_ACCOUNT=1` (the seed ships two companies, which the
  single-company cap would otherwise immediately contradict). `npm run dev` sets both via
  `scripts/dev-fullstack.mjs`, so the dev experience is unchanged.
- `CAPACITYLENS_AUDIT` — append-only JSONL audit log of every AppData mutation (one line per
  mutation: `{ts, userId, accountId, action, entity, id, changedFields}`; `changedFields` is
  field NAMES only, never values, so no PII reaches the log). **ON by default** — the one
  deliberate exception to "default OFF" in this list; set to `off` to disable. Server-mode only.
  - `CAPACITYLENS_AUDIT_FILE` — the audit JSONL path (default: `capacitylens-audit.jsonl`
    beside the DB; a `:memory:` DB falls back to a CWD-relative file).
  - `CAPACITYLENS_AUDIT_MAX_MB` — rotation cap in MB, positive integer (default `64`): once the
    file reaches this size it's rotated to `<file>.1` (the previous `.1` is replaced), bounding
    disk use at roughly 2× the cap.
- `CAPACITYLENS_AUTH` — `off`|`password`|`sso` (default `off`: Better Auth is never
  initialised — no auth tables, no `/api/auth/*` routes beyond the thin `/api/auth/me`,
  every request carries a synthetic demo identity). Any other value refuses to boot.
  When ≠ `off`:
  - `BETTER_AUTH_SECRET` (32+ chars) and `BETTER_AUTH_URL` — required; boot refuses
    loudly if missing.
  - `CAPACITYLENS_SSO_*` (sso mode only) — `CLIENT_ID` + `CLIENT_SECRET`, plus
    `DISCOVERY_URL` or `AUTHORIZATION_URL` + `TOKEN_URL` (optional `PROVIDER_ID`,
    `SCOPES`). Provider choice is config, not code.

## Status / standing posture

Auth is **wired but OFF** (`CAPACITYLENS_AUTH`, Better Auth): sessions/login exist behind the
flag, but the live alpha runs with **NO auth gate at all** (no app-level auth and no Nginx Basic
Auth — the Basic Auth plan was dropped), one shared dataset, last-writer-wins; a real gate is
required before beta — see DECISIONS.md. `ownsRow` is
defense-in-depth, not isolation — the account stays client-asserted until Stage C derives
it from the session. Optimistic concurrency stays off (last-writer-wins) until a client
conflict UI exists. Postgres and real per-account ownership remain deferred (see
`docs/production-plan.md` and `docs/runbook.md` for the deploy/ops side).
