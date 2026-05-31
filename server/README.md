# floaty-server

SQLite-backed, entity-level REST API for Floaty — the optional database backend
behind the `PersistenceAdapter` seam. The default app still runs on `localStorage`;
this server is opt-in via the `VITE_FLOATY_API` env var on the web app.

It deliberately imports the **same** pure domain-core the client uses
(`../src/domain/mutations`, `../src/data/migrate`, `../src/data/seed`, `../src/types`),
so server-side validation, integrity, cascade and import rules are literally the
client's code — not a re-implementation that can drift.

## Requirements

- Node 22+ (uses the built-in `node:sqlite`, run with `--experimental-sqlite` —
  already wired into the npm scripts via `NODE_OPTIONS`).

## Run

```bash
cd server
npm install
npm run dev          # http://localhost:8787, seeds an empty DB on first boot
```

Point the web app at it (from the repo root):

```bash
VITE_FLOATY_API=http://localhost:8787 npm run dev
```

## Scripts

- `npm run dev` — watch-mode server (`floaty.db`).
- `npm start` — one-shot server.
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
| DELETE | `/api/:entity/:id` | Idempotent delete (DB cascades mirror the store). |
| POST | `/api/import` | `{ accountId, data }` — reuses `remapAndValidateImport`. |
| POST | `/api/test/reset` | Wipe (+ optional reseed). Gated by `FLOATY_ALLOW_RESET=1`. |

`:entity` is an `AppData` key: `accounts`, `clients`, `disciplines`, `projects`,
`phases`, `resources`, `tasks`, `allocations`, `timeOff`.

## Validation

The server is the integrity boundary for direct API writes, not just the UI. Every
POST/PUT/PATCH runs two shared-core layers (see `src/validate.ts`): `sanitizeWrite`
repairs value-level fields (enums, colour, hours, `workingDays`) exactly as the
import path does, then `validateWrite` enforces referential integrity + date ranges.
So a hand-crafted request can't persist a junk enum, non-hex colour, NaN/negative
hours, or a dangling foreign key. PATCH is a true partial merge (body merged over the
stored row before validation), not a column-wise overwrite.

## Env

- `FLOATY_DB` — SQLite path (default `floaty.db`; `:memory:` works).
- `PORT` — default `8787`.
- `FLOATY_ALLOW_RESET` — `1` to expose `POST /api/test/reset` (dev/E2E only).
- `FLOATY_CORS_ORIGIN` — CORS allow-list, comma-separated, or `*` to allow any
  origin. **Defaults to the local Vite dev/e2e origins** so the API is not open to
  every site by default. Set it to your deployed app's origin in production.
- `FLOATY_OPTIMISTIC_CONCURRENCY` — `1` to reject a stale overwrite (a PUT whose
  `updatedAt` is older than the stored row) with HTTP 409 instead of last-writer-wins.

## Status / not yet done (Phase 2)

No app-level auth; single shared dataset. Optimistic concurrency exists but is
off by default (last-writer-wins) until real multi-user auth + client-side conflict
resolution land. Postgres, real per-account ownership, and a one-time "push my
localStorage data to the server" flow are deferred to Phase 2.
