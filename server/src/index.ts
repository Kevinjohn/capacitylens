import { buildApp } from './app'
import { openDb, seedIfUninitialized } from './db'
import { seed } from '@floaty/shared/data/seed'

// Entry point. Run with: NODE_OPTIONS=--experimental-sqlite tsx src/index.ts
//   FLOATY_DB                       SQLite file (default ./floaty.db; ':memory:' ok)
//   PORT                            listen port (default 8787)
//   FLOATY_ALLOW_RESET              '1' to expose POST /api/test/reset (dev/E2E only)
//   FLOATY_CORS_ORIGIN              CORS allow-list, comma-separated, or '*' to allow
//                                   any origin. Defaults to the local dev origins so
//                                   the API is NOT open to every site by default.
//   FLOATY_OPTIMISTIC_CONCURRENCY   '1' to reject stale overwrites (409) instead of
//                                   last-writer-wins.

// Locked-down by default: only the local Vite dev/e2e origins may make cross-origin
// browser calls. Set FLOATY_CORS_ORIGIN explicitly (e.g. your deployed app origin,
// or '*') to change this. This is the production-facing default, distinct from
// buildApp's own '*' library default used by unit tests.
const DEFAULT_CORS = 'http://localhost:5173,http://localhost:5273,http://127.0.0.1:5173,http://127.0.0.1:5273'

const dbPath = process.env.FLOATY_DB ?? 'floaty.db'
const port = Number(process.env.PORT ?? 8787)
const allowReset = process.env.FLOATY_ALLOW_RESET === '1'
const corsOrigin = process.env.FLOATY_CORS_ORIGIN ?? DEFAULT_CORS
const optimisticConcurrency = process.env.FLOATY_OPTIMISTIC_CONCURRENCY === '1'

const db = openDb(dbPath)

// Seed once on a NEVER-INITIALISED DB — the server owns first-run seeding so the client's
// hasExisting()/seedIfEmpty path stays a no-op against a server backend. seedIfUninitialized
// gates on the persistent `initialized` marker, NOT mere emptiness: a user who deletes all
// their data leaves an empty-but-initialised DB and must NOT get the demo dataset re-seeded
// on the next restart (matches /api/meta's isInitialized() check).
seedIfUninitialized(db, seed())

const app = buildApp(db, { allowReset, corsOrigin, optimisticConcurrency })

app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => console.log(`floaty-server listening on ${addr} (db=${dbPath}, reset=${allowReset})`))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
