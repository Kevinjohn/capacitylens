import { buildApp } from './app'
import { openDb, loadState, isEmpty, insertAll } from './db'
import { seed } from '@floaty/shared/data/seed'

// Entry point. Run with: NODE_OPTIONS=--experimental-sqlite tsx src/index.ts
//   FLOATY_DB           path to the SQLite file (default ./floaty.db; ':memory:' ok)
//   PORT                listen port (default 8787)
//   FLOATY_ALLOW_RESET  '1' to expose POST /api/test/reset (dev/E2E only)

const dbPath = process.env.FLOATY_DB ?? 'floaty.db'
const port = Number(process.env.PORT ?? 8787)
const allowReset = process.env.FLOATY_ALLOW_RESET === '1'

const db = openDb(dbPath)

// Seed once on a genuinely empty DB — the server owns first-run seeding so the
// client's hasExisting()/seedIfEmpty path stays a no-op against a server backend.
if (isEmpty(loadState(db))) insertAll(db, seed())

const app = buildApp(db, { allowReset })

app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => console.log(`floaty-server listening on ${addr} (db=${dbPath}, reset=${allowReset})`))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
