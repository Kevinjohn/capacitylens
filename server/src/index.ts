import { buildApp, DEFAULT_CORS, parseRateLimit } from './app'
import { openDb, seedIfUninitialized, type Db } from './db'
import { seed } from '@capacitylens/shared/data/seed'
import { createLastResortErrorHandler, createShutdownHandler } from './shutdown'
import { resetForbidden } from './bootGuard'
import { evaluateProductionPosture } from './productionGuard'
import { authFromEnv, runAuthMigrations, createBootstrapAdmin, countUsers, AuthConfigError } from './auth'
import { parseBackupConfig, startBackups } from './backup'
import { compositeAuditSink, fileAuditSink, noopAuditSink, parseAuditConfig, streamAuditSink } from './audit'
import { loadInternalTls } from './internalTls'

// Secrets, SQLite/WAL files, audit logs, and backups created by this process must never inherit a
// permissive shell/container umask. Individual writers also pin 0600 for defence in depth.
process.umask(0o077)

// Entry point. Run with: tsx src/index.ts (Node 24+ — node:sqlite needs no flag)
//   CAPACITYLENS_DB                       SQLite file (default ./capacitylens.db; ':memory:' ok)
//   PORT                            listen port (default 8787)
//   CAPACITYLENS_HOST                     listen host (default 127.0.0.1, localhost-only).
//                                   Set to 0.0.0.0 to deliberately expose on the LAN.
//   CAPACITYLENS_ALLOW_RESET              '1' to expose POST /api/test/reset (dev/E2E only)
//   CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION off by default; set to '1' ONLY to deliberately run
//                                   the open/demo (auth-off) posture under NODE_ENV=production.
//                                   Otherwise auth-off in production refuses to boot — the
//                                   demo dataset would be world-readable/writable (see
//                                   productionGuard.ts).
//   CAPACITYLENS_CORS_ORIGIN              Explicit CORS allow-list, comma-separated. Wildcards
//                                   are rejected because browser requests use cookie credentials.
//                                   Defaults to the local development origins.
//   CAPACITYLENS_OPTIMISTIC_CONCURRENCY   enabled by default; set '0' only to deliberately allow
//                                   stale last-writer-wins overwrites.
//   CAPACITYLENS_MULTI_ACCOUNT             '1' to allow more than one company on this instance.
//                                   Default off: CapacityLens is single-company-per-instance —
//                                   once the accounts table holds one row, every create-a-company
//                                   vector 403s (naming this flag) until you set it, in EVERY auth
//                                   mode including off (see AppOptions.multiAccount in app.ts).
//   CAPACITYLENS_SEED_DEMO                 '1' to seed the two-company demo dataset on a
//                                   never-initialised DB. Default off: a fresh real server starts
//                                   EMPTY (create-your-company first run) — the seed ships TWO
//                                   companies, which is exactly why it can't stay default under
//                                   the single-company cap above.
//   CAPACITYLENS_HTTPS                    '1' when the public origin is real HTTPS — enables
//                                   two-year HSTS including subdomains. Default off: HSTS is invalid/harmful
//                                   over plain HTTP, and this server usually runs HTTP behind
//                                   a TLS-terminating proxy. The other baseline security
//                                   headers (nosniff, CSP, Referrer-Policy, X-Frame-Options)
//                                   are always on, independent of this flag.
//   CAPACITYLENS_INTERNAL_TLS_CERT        PEM certificate for the internal reverse-proxy/API hop.
//   CAPACITYLENS_INTERNAL_TLS_KEY         Matching PEM private key. Both are required in production;
//                                   omitting either refuses startup. The default Compose topology
//                                   creates a per-install CA and leaf certificate automatically.
//   CAPACITYLENS_LOG                      '1' for structured per-request JSON logs (pino) and
//                                   500-errors through the request logger. Default off =
//                                   today's logging (startup line + console.error on 500s).
//   CAPACITYLENS_HEALTH_DEEP              '1' to make /api/health do a constant SELECT 1 plus
//                                   surface the audit-sink state: { ok: true, db: true,
//                                   audit: 'ok' | 'degraded' } (200) or 503 { ok: false }.
//                                   Default off = unconditional { ok: true }.
//   CAPACITYLENS_RATE_LIMIT               requests/minute per IP across every /api/* route,
//                                   including health (safe integer 1–1,000,000). Production
//                                   refuses a missing, zero or invalid value.
//   CAPACITYLENS_BOOTSTRAP_TOKEN          shared secret enabling constrained org-creation via
//                                   POST /api/orgs (header x-capacitylens-bootstrap-token)
//                                   for a caller who is not yet an Owner/Admin. Default off
//                                   (unset/empty = the token path never allows; org-create is
//                                   then first-run-only or an existing Owner/Admin).
//   CAPACITYLENS_BACKUP_DIR               set to a directory to enable periodic online DB
//                                   snapshots there (default off — no timer, no writes).
//   CAPACITYLENS_BACKUP_INTERVAL_MIN      snapshot cadence in whole minutes (default 60,
//                                   maximum 35,000; only read when backups are on).
//   CAPACITYLENS_BACKUP_KEEP              rolling retention count (default 48, maximum 10,000).
//   CAPACITYLENS_AUDIT                    append-only JSONL audit log of every AppData mutation
//                                   (one line {ts,userId,accountId,action,entity,id,changedFields};
//                                   changedFields are field NAMES only — never values, so no PII
//                                   reaches the log). ON BY DEFAULT (the deliberate flag-off
//                                   exception); set to 'off' to disable. Server-mode only.
//   CAPACITYLENS_AUDIT_FILE               the audit JSONL path (default: capacitylens-audit.jsonl
//                                   beside the DB; a ':memory:' DB falls back to a CWD-relative file).
//   CAPACITYLENS_AUDIT_MAX_MB             size-based rotation cap for the audit JSONL, in
//                                   megabytes (safe integer 1–1,048,576; default 64; invalid values
//                                   fall back to the default). At/above the cap, the current
//                                   file is renamed to <file>.1 (replacing any existing .1)
//                                   before the next line is appended, bounding on-disk usage to
//                                   ~2x the cap. Only read when audit is on.
//   CAPACITYLENS_AUTH                     off|password|sso (default off = no Better Auth at
//                                   all; only the thin /api/auth/me exists). Any other
//                                   value refuses to boot. When ≠ off:
//   BETTER_AUTH_SECRET              required — session signing secret (32+ chars).
//   BETTER_AUTH_URL                 required — the public origin the browser uses.
//   CAPACITYLENS_ALLOW_OPEN_SIGNUP        '1' to keep email self-registration open unconditionally
//                                   (trusted-instance/dev escape). Default off: sign-up is closed
//                                   except for an EMPTY user table plus CAPACITYLENS_SETUP_TOKEN.
//   CAPACITYLENS_SETUP_TOKEN              required secret for that first owner sign-up, presented
//                                   by the setup form. A fresh password instance refuses to boot
//                                   without it unless open signup/bootstrap-admin was explicit.
//   CAPACITYLENS_CREATE_ADMIN_ADMIN       development-only first-owner helper (also available as
//                                   --create-owner-admin-admin). It creates admin@admin.admin with
//                                   a generated password only when the password user table is empty.
//                                   Production refuses this path; use CAPACITYLENS_SETUP_TOKEN.
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

// Fail-SOFT numeric parse (mirrors parseBackupConfig's `positive`, not parsePort's refuseToStart):
// this only bounds the audit log's on-disk size, not a security-relevant gate, so a missing/junk
// value falls back to the documented 64 MiB default rather than refusing to boot.
export function parseAuditMaxMb(raw: string | undefined): number {
  const n = Number(raw)
  const maxMb = 1024 * 1024
  return Number.isSafeInteger(n) && n >= 1 && n <= maxMb ? n : 64
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
const optimisticConcurrency = process.env.CAPACITYLENS_OPTIMISTIC_CONCURRENCY !== '0'
// Single-company cap (see AppOptions.multiAccount) — off by default, so a fresh real deploy starts
// capped to the first company it creates until the operator deliberately opts in to more.
const multiAccount = process.env.CAPACITYLENS_MULTI_ACCOUNT === '1'
// HSTS only — gated OFF by default (HSTS over plain HTTP is harmful; this server usually
// runs HTTP behind a TLS proxy). The other helmet baseline headers are on regardless.
const https = process.env.CAPACITYLENS_HTTPS === '1'
const log = process.env.CAPACITYLENS_LOG === '1'
const healthDeep = process.env.CAPACITYLENS_HEALTH_DEEP === '1'
const rateLimit = parseRateLimit(process.env.CAPACITYLENS_RATE_LIMIT)
const requireMfa = process.env.CAPACITYLENS_REQUIRE_MFA === '1'
let internalTls: ReturnType<typeof loadInternalTls>
try {
  internalTls = loadInternalTls(process.env)
} catch (error) {
  refuseToStart(error instanceof Error ? error.message : String(error))
}
// P1.8 constrained org-creation. An empty/unset value leaves the token path DISABLED (the app
// treats undefined and '' identically — bootstrapTokenMatches never allows an empty secret), so
// the secure default holds: POST /api/orgs is first-run-only or an existing Owner/Admin.
const bootstrapToken = process.env.CAPACITYLENS_BOOTSTRAP_TOKEN || undefined
// First-run owner bootstrap: one switch, two spellings — the env var is the repo convention, the
// argv flag exists for one-shot shells (`node ... --create-owner-admin-admin`) where exporting an
// env var is awkward. Normalized ONCE here; everything downstream (the production refusal,
// createBootstrapAdmin) sees a single boolean.
const bootstrapAdmin =
  process.env.CAPACITYLENS_CREATE_ADMIN_ADMIN === '1' || process.argv.includes('--create-owner-admin-admin')
// X-Forwarded-For is only trustworthy when Nginx proxies to us on loopback (every socket
// is then 127.0.0.1); a deliberately-exposed host (CAPACITYLENS_HOST=0.0.0.0) keys on the
// socket address, because the header is client-spoofable there.
const rateLimitTrustForwarded =
  process.env.CAPACITYLENS_RATE_LIMIT_TRUST_FORWARDED === '1' ||
  host === '127.0.0.1' || host === 'localhost' || host === '::1'

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
// Better Auth trusts the same explicit browser origins as the CORS allow-list.
let authMode: ReturnType<typeof authFromEnv>['mode']
let auth: ReturnType<typeof authFromEnv>['auth']
try {
  ;({ mode: authMode, auth } = authFromEnv(db, process.env, {
    trustedOrigins: corsOrigin.split(',').map((s) => s.trim()).filter(Boolean),
  }))
} catch (err) {
  if (err instanceof AuthConfigError) {
    console.error(`capacitylens-server: refusing to start — ${err.message}`)
    process.exit(1)
  }
  throw err
}

// Production safety interlock: once NODE_ENV=production, the dev/open posture must be retired
// — running auth OFF in production would expose the demo dataset. Refuse on fatal posture violations,
// warn loudly on the softer ones. No-op outside production (see productionGuard.ts).
// The posture guard is a pure env predicate, so the argv spelling of the bootstrap flag is folded
// into its env form here — both spellings must trigger the same development-only refusal.
const posture = evaluateProductionPosture(
  bootstrapAdmin ? { ...process.env, CAPACITYLENS_CREATE_ADMIN_ADMIN: '1' } : process.env,
)
for (const w of posture.warnings) {
  console.warn(`capacitylens-server: production posture warning — ${w}`)
}
if (posture.refusals.length > 0) {
  console.error(
    `capacitylens-server: refusing to start — production posture:\n${posture.refusals.map((r) => `  - ${r}`).join('\n')}`,
  )
  process.exit(1)
}
// Create/upgrade the auth tables only when auth is on (an off-mode DB never grows them), then
// OPT-IN seed a never-initialised DB. Both are boot preconditions — a failure must crash legibly,
// not limp on.
//
// Demo seed is OPT-IN (CAPACITYLENS_SEED_DEMO=1), NOT automatic: the seed fixture ships TWO
// companies, which the single-company cap (AppOptions.multiAccount, default off) would otherwise
// immediately contradict on a fresh real deploy — a from-scratch server now starts EMPTY and the
// operator creates their one company as the first-run bootstrap (POST /api/orgs / POST
// /api/accounts, both open while the table is empty). Dev (scripts/dev-fullstack.mjs) sets this
// flag (plus CAPACITYLENS_MULTI_ACCOUNT=1) so its batteries-included two-company fixture is
// unaffected; the auth-e2e harness (server/package.json start:auth-e2e) provisions its orgs live
// via POST /api/orgs instead of this seed, so it only needs CAPACITYLENS_MULTI_ACCOUNT=1.
//
// seedIfUninitialized gates on the persistent `initialized` marker, NOT mere emptiness: a user who
// deletes all their data leaves an empty-but-initialised DB and must NOT get the demo dataset
// re-seeded on the next restart (matches /api/meta's isInitialized() check) — that rule is
// unchanged; this only adds a flag gate in FRONT of it.
try {
  if (auth) await runAuthMigrations(auth)
  // First-run owner bootstrap — AFTER the auth tables exist, BEFORE the app serves a request. In
  // off/sso mode createBootstrapAdmin throws AuthConfigError (the flag is meaningless there),
  // which this catch frames as a legible refusal; with users already present it logs one
  // "skipped" line and boot continues (deliberately NOT an error — see its TSDoc).
  if (bootstrapAdmin) await createBootstrapAdmin(db, authMode, auth)
  if (process.env.CAPACITYLENS_SEED_DEMO === '1') seedIfUninitialized(db, seed())
  if (
    authMode === 'password' &&
    countUsers(db) === 0 &&
    process.env.CAPACITYLENS_ALLOW_OPEN_SIGNUP !== '1' &&
    !process.env.CAPACITYLENS_SETUP_TOKEN
  ) {
    throw new AuthConfigError(
      'A fresh password instance requires CAPACITYLENS_SETUP_TOKEN (or an explicit bootstrap-admin/open-signup override).',
    )
  }
} catch (e) {
  refuseToStart(e instanceof Error ? e.message : String(e))
}

// SETUP LOCKED notice: countUsers is read after the bootstrap block, so a boot that created the
// explicit admin credential skips this. The boot interlock above guarantees the token exists here;
// this line tells the operator why ordinary sign-in cannot work yet without implying the instance
// is claimable by a network visitor.
if (authMode === 'password' && countUsers(db) === 0) {
  console.warn(
    'capacitylens-server: SETUP LOCKED — no user accounts exist yet; owner creation requires the ' +
      'configured CAPACITYLENS_SETUP_TOKEN.',
  )
}

// Audit log (P1.15, flag CAPACITYLENS_AUDIT — ON BY DEFAULT; =off disables). Server-mode only:
// the sink lives here, so the default local/no-server deploy (which never runs index.ts) gets no
// audit automatically. console.error (not app.log) so the rare/operational audit-write error
// doesn't depend on the app.log ordering. The append() is fail-never (see audit.ts) — a broken
// sink latches `degraded` (deep-health surfaces it), never crashes the daemon or fails a request.
const auditCfg = parseAuditConfig(process.env, dbPath)
const auditMaxBytes = parseAuditMaxMb(process.env.CAPACITYLENS_AUDIT_MAX_MB) * 1024 * 1024
const auditFileSink = auditCfg.enabled
  ? fileAuditSink(auditCfg.file, (m) => console.error(m), { maxBytes: auditMaxBytes })
  : noopAuditSink()
const auditSink = process.env.CAPACITYLENS_AUDIT_STDOUT === '1'
  ? compositeAuditSink(auditFileSink, streamAuditSink(console.log))
  : auditFileSink

const securityLog = (event: Record<string, unknown>) => {
  console.log(JSON.stringify({ type: 'capacitylens.security', ts: new Date().toISOString(), ...event }))
}

const app = buildApp(db, {
  internalTls,
  allowReset,
  corsOrigin,
  optimisticConcurrency,
  multiAccount,
  https,
  log,
  healthDeep,
  rateLimit,
  rateLimitTrustForwarded,
  bootstrapToken,
  authMode,
  auth,
  requireMfa,
  audit: auditSink,
  securityLog,
})

// Backups (P4.1, flag CAPACITYLENS_BACKUP_DIR — default OFF: no timer, no filesystem writes).
// Snapshot lines go through pino when CAPACITYLENS_LOG is on, console.log otherwise (P1.3).
const backupConfig = parseBackupConfig(process.env)
const backups = backupConfig
  ? startBackups(db, backupConfig, log ? (m) => app.log.info(m) : console.log)
  : null

// Graceful shutdown (P1.2): the deploy restarts the daemon with a signal — drain in-flight
// requests, then close the DB, instead of dying mid-transaction. A repeat signal force-exits.
// Backups stop FIRST — the timer is cleared AND any in-flight snapshot is awaited — so the
// DB is never closed under a running backup (P4.1; a SIGTERM during the start-up shot would
// otherwise truncate a snapshot mid-write).
const shutdown = createShutdownHandler(
  {
    close: async () => {
      await backups?.stop()
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

const lastResort = createLastResortErrorHandler(
  shutdown,
  securityLog,
  (message, error) => console.error(message, error),
)
process.on('uncaughtException', (error) => {
  void lastResort('uncaught_exception', error)
})
process.on('unhandledRejection', (reason) => {
  void lastResort('unhandled_rejection', reason)
})

app
  .listen({ port, host })
  .then((addr) => console.log(`capacitylens-server listening on ${addr} (db=${dbPath}, reset=${allowReset})`))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
