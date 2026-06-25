import { buildApp, DEFAULT_CORS, parseRateLimit } from './app'
import { openDb, seedIfUninitialized, type Db } from './db'
import { seed } from '@capacitylens/shared/data/seed'
import { createShutdownHandler } from './shutdown'
import { resetForbidden } from './bootGuard'
import { authFromEnv, runAuthMigrations, AuthConfigError } from './auth'
import { parseBackupConfig, startBackups } from './backup'

// Entry point. Run with: tsx src/index.ts (Node 24+ — node:sqlite needs no flag)
//   CAPACITYLENS_DB                       SQLite file (default ./capacitylens.db; ':memory:' ok)
//   PORT                            listen port (default 8787)
//   CAPACITYLENS_HOST                     listen host (default 127.0.0.1, localhost-only).
//                                   Set to 0.0.0.0 to deliberately expose on the LAN.
//   CAPACITYLENS_ALLOW_RESET              '1' to expose POST /api/test/reset (dev/E2E only)
//   CAPACITYLENS_CORS_ORIGIN              CORS allow-list, comma-separated, or '*' to allow
//                                   any origin. Defaults to the local dev origins so
//                                   the API is NOT open to every site by default.
//   CAPACITYLENS_OPTIMISTIC_CONCURRENCY   '1' to reject stale overwrites (409) instead of
//                                   last-writer-wins.
//   CAPACITYLENS_LOG                      '1' for structured per-request JSON logs (pino) and
//                                   500-errors through the request logger. Default off =
//                                   today's logging (startup line + console.error on 500s).
//   CAPACITYLENS_HEALTH_DEEP              '1' to make /api/health do a trivial DB read:
//                                   { ok, db: true } or 503 { ok: false }. Default off =
//                                   unconditional { ok: true }.
//   CAPACITYLENS_RATE_LIMIT               requests/minute per IP across /api/* (positive
//                                   integer; unset/0/non-numeric = off, fail-closed).
//                                   /api/health is exempt.
//   CAPACITYLENS_BACKUP_DIR               set to a directory to enable periodic online DB
//                                   snapshots there (default off — no timer, no writes).
//   CAPACITYLENS_BACKUP_INTERVAL_MIN      snapshot cadence in minutes (default 60; only read
//                                   when backups are on).
//   CAPACITYLENS_BACKUP_KEEP              rolling retention count (default 48; oldest pruned).
//   CAPACITYLENS_AUTH                     off|password|sso (default off = no Better Auth at
//                                   all; only the thin /api/auth/me exists). Any other
//                                   value refuses to boot. When ≠ off:
//   BETTER_AUTH_SECRET              required — session signing secret (32+ chars).
//   BETTER_AUTH_URL                 required — the public origin the browser uses.
//   CAPACITYLENS_SSO_*                    sso mode only: CLIENT_ID + CLIENT_SECRET, plus
//                                   DISCOVERY_URL or AUTHORIZATION_URL + TOKEN_URL
//                                   (optional PROVIDER_ID, SCOPES).

// CORS is locked down by default to the local Vite dev/e2e origins (DEFAULT_CORS, the
// same fail-closed default buildApp uses). Set CAPACITYLENS_CORS_ORIGIN explicitly (e.g. your
// deployed app origin, or '*') to change it.

// Print one clear "refusing to start" line and exit non-zero. Boot SHOULD crash on a bad
// precondition (we never limp along half-configured) — this just makes the failure legible to an
// operator instead of a raw stack, matching the framed AuthConfigError / resetForbidden paths.
function refuseToStart(reason: string): never {
  console.error(`capacitylens-server: refusing to start — ${reason}`)
  process.exit(1)
}

// Fail-closed PORT parse (mirrors parseRateLimit): a typo like PORT=abc or an out-of-range value
// must not silently fall through to a confusing app.listen error — reject it up front with a clear
// message. Unset → the 8787 default.
function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 8787
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    refuseToStart(`PORT must be an integer 1..65535, got ${JSON.stringify(raw)}.`)
  }
  return n
}

// Safety interlock before anything opens: the test-only reset route must be impossible
// in production (see bootGuard.ts).
if (resetForbidden(process.env)) {
  console.error(
    'capacitylens-server: refusing to start — CAPACITYLENS_ALLOW_RESET=1 with NODE_ENV=production would expose the destructive test-only reset route. Unset one of them.',
  )
  process.exit(1)
}

const dbPath = process.env.CAPACITYLENS_DB ?? 'capacitylens.db'
const port = parsePort(process.env.PORT)
// Bind localhost-only by default so a dev/laptop run isn't reachable from the LAN; set
// CAPACITYLENS_HOST=0.0.0.0 to deliberately expose it (container/LAN/deploy).
const host = process.env.CAPACITYLENS_HOST ?? '127.0.0.1'
const allowReset = process.env.CAPACITYLENS_ALLOW_RESET === '1'
const corsOrigin = process.env.CAPACITYLENS_CORS_ORIGIN ?? DEFAULT_CORS
const optimisticConcurrency = process.env.CAPACITYLENS_OPTIMISTIC_CONCURRENCY === '1'
const log = process.env.CAPACITYLENS_LOG === '1'
const healthDeep = process.env.CAPACITYLENS_HEALTH_DEEP === '1'
const rateLimit = parseRateLimit(process.env.CAPACITYLENS_RATE_LIMIT)
// X-Forwarded-For is only trustworthy when Nginx proxies to us on loopback (every socket
// is then 127.0.0.1); a deliberately-exposed host (CAPACITYLENS_HOST=0.0.0.0) keys on the
// socket address, because the header is client-spoofable there.
const rateLimitTrustForwarded = host === '127.0.0.1' || host === 'localhost' || host === '::1'

// openDb crashing is the right outcome (a broken/unopenable DB must NOT start) — frame it so the
// operator gets one clear line, not a raw node:sqlite stack.
let db: Db
try {
  db = openDb(dbPath)
} catch (e) {
  refuseToStart(e instanceof Error ? e.message : String(e))
}

// Auth (P3.1/P3.2): parsed + initialised before the app exists; any misconfiguration
// (bad CAPACITYLENS_AUTH value, missing secret/URL in password/sso mode) refuses to boot
// loudly. In 'off' mode authFromEnv returns null without reading any BETTER_AUTH_* env.
// Better Auth trusts the same browser origins the CORS allow-list names ('*' trusts
// none extra — the same-origin deploy needs none).
let authMode: ReturnType<typeof authFromEnv>['mode']
let auth: ReturnType<typeof authFromEnv>['auth']
try {
  ;({ mode: authMode, auth } = authFromEnv(db, process.env, {
    trustedOrigins: corsOrigin === '*' ? undefined : corsOrigin.split(',').map((s) => s.trim()).filter(Boolean),
  }))
} catch (err) {
  if (err instanceof AuthConfigError) {
    console.error(`capacitylens-server: refusing to start — ${err.message}`)
    process.exit(1)
  }
  throw err
}
// Create/upgrade the auth tables only when auth is on (an off-mode DB never grows them), then seed
// a never-initialised DB. Both are boot preconditions — a failure must crash legibly, not limp on.
//
// Seed once on a NEVER-INITIALISED DB — the server owns first-run seeding so the client's
// hasExisting()/seedIfEmpty path stays a no-op against a server backend. seedIfUninitialized
// gates on the persistent `initialized` marker, NOT mere emptiness: a user who deletes all
// their data leaves an empty-but-initialised DB and must NOT get the demo dataset re-seeded
// on the next restart (matches /api/meta's isInitialized() check).
try {
  if (auth) await runAuthMigrations(auth)
  seedIfUninitialized(db, seed())
} catch (e) {
  refuseToStart(e instanceof Error ? e.message : String(e))
}

const app = buildApp(db, {
  allowReset,
  corsOrigin,
  optimisticConcurrency,
  log,
  healthDeep,
  rateLimit,
  rateLimitTrustForwarded,
  authMode,
  auth,
})

// Backups (P4.1, flag CAPACITYLENS_BACKUP_DIR — default OFF: no timer, no filesystem writes).
// Snapshot lines go through pino when CAPACITYLENS_LOG is on, console.log otherwise (P1.3).
const backupConfig = parseBackupConfig(process.env)
const backups = backupConfig
  ? startBackups(db, backupConfig, log ? (m) => app.log.info(m) : console.log)
  : null

app
  .listen({ port, host })
  .then((addr) => console.log(`capacitylens-server listening on ${addr} (db=${dbPath}, reset=${allowReset})`))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

// Graceful shutdown (P1.2): the deploy restarts the daemon with a signal — drain in-flight
// requests, then close the DB, instead of dying mid-transaction. A repeat signal force-exits.
// The backup timer stops FIRST so a drain never races a snapshot of the closing DB (P4.1).
const shutdown = createShutdownHandler(
  {
    close: async () => {
      backups?.stop()
      await app.close()
    },
  },
  db,
  (code) => process.exit(code),
)
const onSignal = (sig: NodeJS.Signals) => {
  console.log(`capacitylens-server: ${sig} — draining requests, then exiting`)
  void shutdown()
}
process.on('SIGTERM', () => onSignal('SIGTERM'))
process.on('SIGINT', () => onSignal('SIGINT'))
