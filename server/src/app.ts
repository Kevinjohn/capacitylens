import Fastify from 'fastify'
import rateLimitPlugin from '@fastify/rate-limit'
import helmetPlugin from '@fastify/helmet'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { DEMO_USER, type Auth, type AuthMode, type SessionUser } from './auth'

// The identity requireUser attaches to every gated request (P3.2). Session/identity
// plumbing ONLY — accountId stays client-asserted (ownsRow is still the tenant guard);
// this is the seam Stage C will later use to derive accountId server-side.
declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null
  }
}
import { parseData, MAX_IMPORT_RECORDS } from '@capacitylens/shared/data/transfer'
import { remapAndValidateImport } from '@capacitylens/shared/domain/mutations'
import { seed } from '@capacitylens/shared/data/seed'
import { TABLES } from './tables'
import { validateWrite, sanitizeWrite, ValidationError } from './validate'
import {
  type Db,
  deleteRow,
  getRow,
  insertAll,
  insertRow,
  isInitialized,
  loadState,
  replaceAccountSlice,
  upsertRow,
  wipe,
} from './db'
import { tx } from './txn'

// ~5 MB request cap. A normal account is far smaller; an over-cap body is rejected
// by Fastify with 413 before our handlers run (mirrors the client's import guard).
const BODY_LIMIT = 5 * 1024 * 1024

// Fail-CLOSED CORS default: only the local Vite dev/e2e origins may make cross-origin
// browser calls. The factory itself uses this (not a wildcard) so a caller that forgets
// to pass corsOrigin is still locked down; opening the API to every site requires an
// EXPLICIT '*'. The entrypoint (index.ts) imports this same default and lets
// CAPACITYLENS_CORS_ORIGIN override it for a deliberate deploy.
export const DEFAULT_CORS =
  'http://localhost:5173,http://localhost:5273,http://127.0.0.1:5173,http://127.0.0.1:5273'

export interface AppOptions {
  /** Gate POST /api/test/reset — only enabled for tests / explicit dev opt-in. */
  allowReset?: boolean
  /** CAPACITYLENS_LOG=1 — structured per-request logging (Fastify's bundled pino, JSON on
   *  stdout: method/path/status/latency), and the 500-path error log routed through the
   *  request-scoped logger. Default OFF = exactly today's behaviour (startup line +
   *  console.error on 500s). */
  log?: boolean
  /** Test seam: where the JSON log lines go when `log` is on (default stdout). */
  logStream?: { write(msg: string): void }
  /** CAPACITYLENS_HEALTH_DEEP=1 — /api/health also proves the DB answers a trivial read:
   *  200 { ok, db: true }, or 503 { ok: false } when the read throws. Default OFF =
   *  today's unconditional { ok: true } (Playwright's webServer probe depends on it). */
  healthDeep?: boolean
  /** CAPACITYLENS_RATE_LIMIT=<n> — n requests/minute per IP across /api/* (a guard against an
   *  accidental client loop hammering the single-writer SQLite file, NOT a security
   *  control). /api/health is exempt. <= 0 / omitted ⇒ the plugin is not registered at
   *  all (today's behaviour) — see parseRateLimit for the fail-closed env parse. */
  rateLimit?: number
  /** Key the rate limit on the first X-Forwarded-For hop instead of the socket address.
   *  Set ONLY when the listen host is loopback (i.e. behind the Nginx proxy, where every
   *  socket is 127.0.0.1); on a directly-exposed host the header is client-spoofable. */
  rateLimitTrustForwarded?: boolean
  /** CAPACITYLENS_AUTH (P3.2): 'off' (the default) means Better Auth does not exist here —
   *  the only auth surface is GET /api/auth/me reporting the demo identity, and
   *  requireUser attaches that identity and continues, so NO request that succeeds
   *  today may fail. 'password'/'sso' mount opts.auth's handler at /api/auth/* and
   *  401 every other /api/* route (except /api/health) without a valid session. */
  authMode?: AuthMode
  /** The Better Auth instance — required exactly when authMode ≠ 'off'. */
  auth?: Auth | null
  /** CORS allow-list: a comma-separated origin list, or an EXPLICIT '*' to allow any
   *  origin. Defaults FAIL-CLOSED to the localhost allow-list (DEFAULT_CORS) when
   *  omitted — so the factory is safe even if a caller forgets to pass it. The
   *  entrypoint (index.ts) passes the CAPACITYLENS_CORS_ORIGIN override. */
  corsOrigin?: string
  /** When true, PUT rejects a write whose row is older than the stored row
   *  (updatedAt compare) with 409. Default off: the prototype is single-dataset,
   *  no-auth, last-writer-wins by design (see the plan). Turn on once real
   *  multi-user auth + client conflict-resolution land. */
  optimisticConcurrency?: boolean
  /** CAPACITYLENS_HTTPS=1 — the API is reached over HTTPS, so HSTS is safe to emit.
   *  Default false: HSTS (Strict-Transport-Security) is ONLY valid over HTTPS and is
   *  actively HARMFUL over plain HTTP — a browser that caches an HSTS directive received
   *  on http:// would force https:// on a host that has no TLS, breaking it. This server
   *  typically runs HTTP behind a TLS-terminating proxy (Nginx), so the operator must
   *  OPT IN once TLS truly fronts the public origin. Off ⇒ helmet emits no HSTS header;
   *  all other helmet baseline headers (nosniff, CSP, Referrer-Policy, X-Frame-Options)
   *  are on regardless, as they are pure improvements with no HTTPS precondition. */
  https?: boolean
}

// P0.5.5: NEVER let a secret reach the logs. pino strips these exact paths from every record
// when logging is on; remove:true DELETES the key (so the value is gone entirely, not printed as
// "[Redacted]"). DEFENSE-IN-DEPTH: Fastify's default req/res serializers don't log headers at all
// (req → method/url/hostname/remoteAddress; res → statusCode/responseTime), so today nothing here
// would emit these — but the moment a custom serializer logs headers, or someone logs a raw req/res,
// this is the backstop that keeps Authorization / Cookie / Set-Cookie out of stdout. If such a
// serializer is ever added, extend this list to cover any new path it surfaces.
const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
]

/** Fail-closed parse of CAPACITYLENS_RATE_LIMIT: only a positive integer turns the limiter on;
 *  unset, '0', negative, or any non-numeric junk ⇒ 0 = off (a typo must not guess a limit). */
export function parseRateLimit(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) return 0
  return Number(raw)
}

/** Node's IncomingHttpHeaders → web Headers, for Better Auth's web-standard API
 *  (getSession reads the cookie; the mounted handler gets the full set). */
function toWebHeaders(raw: FastifyRequest['headers']): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') headers.append(key, value)
    else if (Array.isArray(value)) for (const item of value) headers.append(key, item)
  }
  return headers
}

const isKnownTable = (entity: string): entity is keyof typeof TABLES =>
  Object.prototype.hasOwnProperty.call(TABLES, entity)

// A table is "scoped" (tenant-owned) when it carries an accountId column — every table
// except top-level `accounts`. Scoped deletes must assert ownership via accountId.
const isScopedTable = (entity: keyof typeof TABLES): boolean =>
  TABLES[entity].columns.some((c) => c.name === 'accountId')

// The wire shape of one op in a POST /api/batch body (mirrors the client's syncOps.Op).
interface BatchOp {
  method: 'PUT' | 'DELETE'
  table: string
  id: string
  row?: Record<string, unknown>
  accountId?: string
}

// Tenant-ownership predicate shared by every mutating route. A row is "owned" by
// `accountId` when there's no existing row yet (a fresh upsert), or its stored accountId
// matches. PUT/PATCH use it to keep accountId IMMUTABLE (409 on a change that would re-home
// a row across the tenant boundary); DELETE uses it to scope a delete to its owner (404 on
// a cross-account target — the server analog of the client's findOwned guard). One
// predicate, so a future write path can't silently skip the check.
const ownsRow = (existing: { accountId?: unknown } | undefined, accountId: unknown): boolean =>
  !existing || existing.accountId === accountId

// Resolve the Access-Control-Allow-Origin value for a request. '*' echoes the
// wildcard; an allow-list reflects the request's Origin only when it's on the list
// (and otherwise sends no ACAO header, so the browser blocks the cross-origin call).
// Requests with no Origin (curl, server-to-server, Playwright's APIRequestContext)
// are unaffected — CORS only governs browser cross-origin reads.
function resolveCorsOrigin(reqOrigin: string | undefined, allow: string): string | null {
  if (allow === '*') return '*'
  const list = allow.split(',').map((s) => s.trim()).filter(Boolean)
  return reqOrigin && list.includes(reqOrigin) ? reqOrigin : null
}

// Map a thrown error to an HTTP status. Caller-fault errors — domain validation
// (ValidationError) and DB constraint/FK violations — are 400; anything else is an
// unexpected server/db bug and must surface as 500 (not be hidden as a 400).
// Exported for unit testing the classification.
export function statusFor(err: unknown): number {
  if (err instanceof ValidationError) return 400
  const msg = err instanceof Error ? err.message : String(err)
  // SQLite spells EVERY constraint error "<kind> constraint failed" (FOREIGN KEY / NOT NULL
  // / UNIQUE / CHECK), so match the full phrase only. The old loose alternation on bare
  // tokens (NOT NULL / UNIQUE / FOREIGN KEY) could misclassify an unrelated 500 whose
  // message merely contained one of those words as a caller-fault 400 — and then leak its
  // raw message. (Matches the whole-state siblings' tightened classifier.)
  //
  // FRAGILE BY NATURE: this rests on node:sqlite's EXACT wording. A library/locale change to the
  // phrase would silently misclassify — a real 500 → 400 (losing its server-side log) or a 400 →
  // 500 — so it's pinned by a unit test that triggers each real constraint kind and asserts the
  // message still contains "constraint failed" (see the statusFor test in app.test.ts).
  if (/constraint failed/i.test(msg)) return 400
  return 500
}

function fail(reply: FastifyReply, err: unknown, logError: (e: unknown) => void = console.error) {
  const status = statusFor(err)
  // A 500 is an unexpected server/db bug: log the real error server-side but return a
  // GENERIC body so we never leak internals (stack-ish messages, SQL, paths).
  if (status === 500) {
    logError(err)
    return reply.code(500).send({ error: 'Internal server error' })
  }
  // 400s: a curated ValidationError message is safe AND useful (it's a friendly sentence we
  // authored). A raw DB-constraint message (e.g. "NOT NULL constraint failed: clients.color")
  // leaks schema internals — genericise it, mirroring the 500 redaction one tier down.
  const message = err instanceof ValidationError
    ? err.message
    : 'That change references missing data or conflicts with an existing record.'
  return reply.code(status).send({ error: message })
}

export function buildApp(db: Db, opts: AppOptions = {}): FastifyInstance {
  const authMode = opts.authMode ?? 'off'
  const auth = opts.auth ?? null
  // Misconfiguration, not a request-time condition: fail at construction, loudly.
  if (authMode !== 'off' && !auth) {
    throw new Error(`buildApp: authMode '${authMode}' requires a Better Auth instance (opts.auth)`)
  }
  const logOn = opts.log === true
  const app = Fastify({
    bodyLimit: BODY_LIMIT,
    // CAPACITYLENS_LOG=1 turns on Fastify's bundled pino (JSON to stdout; no new dependency).
    // ON always attaches the redact config (both branches) so a secret can never reach the
    // logs — see LOG_REDACT_PATHS. Off ⇒ logger disabled entirely — today's behaviour, byte for byte.
    logger: logOn
      ? { ...(opts.logStream ? { stream: opts.logStream } : {}), redact: { paths: LOG_REDACT_PATHS, remove: true } }
      : false,
  })
  // Fail-closed: an omitted corsOrigin locks to the localhost allow-list, NOT a wildcard.
  const corsOrigin = opts.corsOrigin ?? DEFAULT_CORS
  // 500s with logging ON go through the request-scoped logger (one parseable JSON line,
  // correlated with the request); OFF keeps today's bare console.error.
  const sendFail = (reply: FastifyReply, err: unknown) =>
    fail(reply, err, logOn ? (e: unknown) => reply.log.error(e) : undefined)

  // Single redaction funnel for any UNCAUGHT throw (a route that forgot a try/catch, a
  // SQLITE_BUSY thrown mid-statement). Fastify framework errors (413 payload-too-large,
  // 400 malformed JSON) carry their own statusCode + a safe generic message — preserve
  // them; everything else routes through fail() so a 500 stays generic and a 400
  // DB-constraint message can't leak SQLite internals.
  app.setErrorHandler((err, req, reply) => {
    const fwStatus = (err as { statusCode?: number }).statusCode
    if (typeof fwStatus === 'number') {
      if (fwStatus >= 500) {
        if (logOn) req.log.error(err)
        else console.error(err)
        return reply.code(fwStatus).send({ error: 'Internal server error' })
      }
      return reply.code(fwStatus).send({ error: err instanceof Error ? err.message : 'Bad request' })
    }
    return sendFail(reply, err)
  })

  // Baseline security headers (P0.5.3, @fastify/helmet): ON by default — these are pure
  // hardening with no precondition, for an API server that returns JSON only (the SPA is
  // served by Nginx, not here). Registered EARLY, before route plugins, so its onRequest
  // hook decorates every response. helmet defaults already give us nosniff
  // (X-Content-Type-Options) and X-Frame-Options: DENY (frameguard) for legacy browsers; we
  // add a strict, minimal CSP whose frame-ancestors 'none' is the modern clickjacking guard,
  // and a no-referrer Referrer-Policy. The CSP carries EXACTLY five directives (default/connect/
  // base-uri 'self', frame-ancestors 'none', object-src 'none') — useDefaults:false below keeps
  // helmet from merging its defaults (script-src/style-src 'unsafe-inline'/img-src/etc.), since
  // nothing here loads scripts or styles. HSTS is the ONE header
  // gated OFF by default — see opts.https: it is only valid over real HTTPS, and this server
  // usually runs HTTP behind a TLS proxy, so the operator opts in via CAPACITYLENS_HTTPS=1.
  void app.register(helmetPlugin, {
    contentSecurityPolicy: {
      // useDefaults:false — we emit EXACTLY these directives, nothing merged in. This is a
      // JSON-only API (no script/style/img sources are ever needed), so helmet's defaults
      // (script-src/style-src 'unsafe-inline'/img-src/font-src/form-action/upgrade-insecure-
      // requests) would only ship surface this server never uses. Leaving useDefaults at its
      // true default silently merged all of that — including 'unsafe-inline' and upgrade-
      // insecure-requests — past the explicit set below; this pins the wire CSP to the minimal set.
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'object-src': ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    // X-Frame-Options: DENY for legacy browsers (helmet's default is SAMEORIGIN); the modern
    // equivalent is the CSP frame-ancestors 'none' above. This API is never framed, so DENY.
    frameguard: { action: 'deny' },
    // OFF over HTTP (the default deploy: HTTP behind a TLS-terminating proxy); only emitted
    // when the operator asserts real HTTPS fronts the origin (opts.https / CAPACITYLENS_HTTPS=1).
    hsts: opts.https === true ? { maxAge: 15552000, includeSubDomains: true } : false,
  })

  // Rate limiting (P1.5, flag CAPACITYLENS_RATE_LIMIT): registered ONLY when a positive limit
  // was configured — off means the plugin doesn't exist in the app at all. Keyed per IP;
  // behind the Nginx proxy every socket is loopback, so rateLimitTrustForwarded swaps the
  // key to the first X-Forwarded-For hop there (and only there). 429s flow through the
  // setErrorHandler above, so the refusal is the API's usual { error } JSON shape.
  const rateLimitMax = opts.rateLimit ?? 0
  if (rateLimitMax > 0) {
    void app.register(rateLimitPlugin, {
      max: rateLimitMax,
      timeWindow: '1 minute',
      keyGenerator: (req: FastifyRequest) => {
        if (opts.rateLimitTrustForwarded === true) {
          const xff = req.headers['x-forwarded-for']
          const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim()
          if (first) return first
        }
        return req.ip
      },
    })
  }

  // requireUser (P3.2) — ONE gate for everything under /api/ except /api/health (the
  // uptime monitor has no session) and /api/auth/* (the login machinery itself; our
  // /api/auth/me handles its own 401). Root-level so child routes inherit it; preHandler
  // only fires for MATCHED routes, so 404s and the CORS preflight 204 are unaffected.
  // 'off' attaches the synthetic demo identity and continues — no request that succeeds
  // today may fail. Other modes resolve the Better Auth session or 401.
  app.decorateRequest('user', null)
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?', 1)[0]
    if (!path.startsWith('/api/') || path === '/api/health' || path.startsWith('/api/auth/')) return
    if (authMode === 'off') {
      req.user = DEMO_USER
      return
    }
    try {
      const session = await auth!.api.getSession({ headers: toWebHeaders(req.headers) })
      if (!session) return reply.code(401).send({ error: 'Sign in to continue.' })
      req.user = session.user
    } catch (e) {
      // The auth backend (Better Auth / its DB) FAILED — this is NOT "no session". CRITICAL: do
      // not fall through leaving req.user null while letting the handler run (that would serve an
      // UNAUTHENTICATED request). Reject with a 503 (distinct from a credentials-style 401);
      // returning a reply from a preHandler short-circuits the route, so the handler never executes.
      req.log.error(e)
      return reply.code(503).send({ error: 'Sign-in is temporarily unavailable.' })
    }
  })

  // Deep mode prepares the trivial read ONCE, here in the synchronous factory body while
  // the DB is known-open; a later closed/corrupt/locked DB makes get() throw at request
  // time, which is exactly the signal the uptime monitor needs (a bare { ok: true } from
  // a server whose DB is broken is a lie).
  const healthStmt = opts.healthDeep === true ? db.prepare('SELECT 1') : null

  // No app-level auth in this phase. CORS is the only cross-origin gate, so the
  // entrypoint locks it to an allow-list in production (see index.ts). Preflight is
  // answered here. This hook MUST live on the ROOT instance, not in the routes child
  // below: there are no OPTIONS routes, so a preflight takes the not-found path, and
  // only root-level hooks run there — a child-scoped hook would leave preflights as
  // bare 404s without CORS headers, silently blocking every cross-origin write.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = resolveCorsOrigin(req.headers.origin, corsOrigin)
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin)
      if (origin !== '*') {
        reply.header('Vary', 'Origin')
        // P3.4: the client sends credentials: 'include' on every request, and the browser
        // refuses a credentialed cross-origin response without this header. Only ever
        // paired with a REFLECTED allow-listed origin — credentials with '*' are invalid
        // (and browsers reject them), so the wildcard stays uncredentialed by design.
        reply.header('Access-Control-Allow-Credentials', 'true')
      }
    }
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') reply.code(204).send()
  })

  // Every route below registers through a child plugin, NOT directly on the root:
  // @fastify/rate-limit attaches to routes via an onRoute hook that only exists once the
  // plugin LOADS (at ready(), in registration order) — a route declared straight on the
  // root would register first and silently escape the limiter. The child loads after it,
  // so its routes are seen, and it inherits the root CORS hook + error handler. The
  // callback shadows `app` deliberately: the route code is identical without the wrapper.
  void app.register(async (app) => {
    // config.rateLimit: false exempts health from the limiter (inert when it isn't
    // registered) — the uptime monitor must never be told 429.
    app.get('/api/health', { config: { rateLimit: false } }, (_req, reply) => {
      if (!healthStmt) return { ok: true }
      try {
        healthStmt.get()
        return { ok: true, db: true }
      } catch {
        // INTENTIONAL empty catch: the 503 IS the surfacing. A broken DB must make the uptime
        // monitor see 503 — not a lying { ok: true } 200, and not a thrown 500. Do NOT "fix" this
        // by logging-and-rethrowing; the status code is the signal the monitor needs.
        return reply.code(503).send({ ok: false })
      }
    })

    // Thin identity route (P3.2) — exists in EVERY mode so the client never forks on a
    // flag: { authMode, user }. 'off' reports the demo identity unconditionally; other
    // modes report the Better Auth session user, or 401 (with authMode, so the login
    // screen knows which form to show) when there is no session.
    app.get('/api/auth/me', async (req, reply) => {
      if (authMode === 'off') return { authMode, user: DEMO_USER }
      try {
        const session = await auth!.api.getSession({ headers: toWebHeaders(req.headers) })
        if (!session) return reply.code(401).send({ authMode, error: 'Sign in to continue.' })
        return { authMode, user: session.user }
      } catch (e) {
        // The auth backend failed — NOT "no session". Surface a 503 with a clear, DISTINCT message
        // (the client can tell "temporarily unavailable" from a 401 "bad/again credentials") rather
        // than letting it fall through to the generic 500 redaction.
        req.log.error(e)
        return reply.code(503).send({ authMode, error: 'Sign-in is temporarily unavailable.' })
      }
    })

    // Better Auth's own endpoints (sign-up/sign-in/sign-out/session/OAuth callbacks),
    // mounted ONLY when auth is on — in 'off' mode this route does not exist (the OFF
    // guarantee: zero new attack surface). The static /api/auth/me above outranks this
    // wildcard in Fastify's router. Translation layer: Fastify req → web Request,
    // web Response → Fastify reply (set-cookie kept as separate headers; content-length
    // recomputed by Fastify).
    if (authMode !== 'off' && auth) {
      app.route({
        method: ['GET', 'POST'],
        url: '/api/auth/*',
        handler: async (req, reply) => {
          const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
          const response = await auth.handler(
            new Request(url, {
              method: req.method,
              headers: toWebHeaders(req.headers),
              body: req.body === undefined || req.body === null ? undefined : JSON.stringify(req.body),
            }),
          )
          reply.status(response.status)
          response.headers.forEach((value, key) => {
            if (key === 'set-cookie' || key === 'content-length' || key === 'transfer-encoding') return
            reply.header(key, value)
          })
          const cookies = response.headers.getSetCookie()
          if (cookies.length > 0) reply.header('set-cookie', cookies)
          return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null)
        },
      })
    }

    // Whole-state read backs the client's PersistenceAdapter.loadAll(). Only WRITES
    // are entity-level; reads stay whole-tree so hydration is one round-trip.
    app.get('/api/state', () => loadState(db))

    // "has this dataset ever been initialised" (persistent marker), NOT "is it currently
    // non-empty" — so a user who deletes all their data isn't re-seeded on the next load
    // (the bug was: an emptied dataset reported hasData:false and got the demo seed back).
    app.get('/api/meta', () => ({ hasData: isInitialized(db) }))

    // A bare account write (entity === 'accounts') deliberately does NOT auto-mint that account's
    // built-in Internal client. Runtime Internal creation is the CLIENT's job: the web store's
    // addAccount mints the account AND its Internal atomically, and they reach here as TWO separate
    // entity writes (a /api/batch whose ordered ops put the account before the client — see
    // syncOps.UPSERT_ORDER). If the server minted one here too, that client-sent Internal would be a
    // SECOND builtin and validateWrite would reject it (wouldAddSecondBuiltin), breaking sync. So the
    // floor is established by the client's own write, not here; openDb's ensureInternalClients is a
    // BOOT-TIME backfill for seeded/migrated/legacy data, NOT a per-insert trigger. A direct-API
    // account POST that does not ALSO write an Internal is an unsupported/degraded path the web app
    // never takes (that account has no Internal until the next server restart backfills it).
    app.post('/api/:entity', (req, reply) => {
      const { entity } = req.params as { entity: string }
      if (!isKnownTable(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` })
      try {
        const row = sanitizeWrite(entity, req.body as Record<string, unknown>)
        validateWrite(loadState(db), entity, row)
        insertRow(db, entity, row)
        return reply.code(201).send(row)
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    // Idempotent upsert by id — the verb the client sync adapter uses for every
    // create AND update, so a replayed batch (after a partial failure) is safe. The
    // body's id must match the URL id.
    app.put('/api/:entity/:id', (req, reply) => {
      const { entity, id } = req.params as { entity: string; id: string }
      if (!isKnownTable(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` })
      const body = req.body as Record<string, unknown>
      if (body?.id !== id) return reply.code(400).send({ error: 'Body id must match the URL id.' })
      try {
        const existing = getRow(db, entity, id)
        // accountId is immutable: a write must not move an EXISTING row to another account
        // (see ownsRow). The web store enforces this via findOwned; without the same guard a
        // crafted request could re-home a row and orphan its children across the tenant boundary.
        if (!ownsRow(existing, body.accountId)) {
          return reply.code(409).send({ error: 'That record belongs to a different company.' })
        }
        // Optimistic concurrency (opt-in): refuse to overwrite a strictly newer row.
        if (
          opts.optimisticConcurrency &&
          existing &&
          typeof existing.updatedAt === 'string' &&
          typeof body.updatedAt === 'string' &&
          existing.updatedAt > body.updatedAt
        ) {
          return reply.code(409).send({ error: 'The record was modified more recently on the server.', current: existing })
        }
        const row = sanitizeWrite(entity, body)
        validateWrite(loadState(db), entity, row)
        upsertRow(db, entity, row)
        return reply.code(200).send(row)
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    // True partial patch: merge the body over the stored row, then sanitize + validate
    // the MERGED entity before writing. (A blind column-wise update would null every
    // field the body omits.) 404 when the row doesn't exist.
    app.patch('/api/:entity/:id', (req, reply) => {
      const { entity, id } = req.params as { entity: string; id: string }
      if (!isKnownTable(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` })
      try {
        const existing = getRow(db, entity, id)
        if (!existing) return reply.code(404).send({ error: 'Not found' })
        const merged = sanitizeWrite(entity, { ...existing, ...(req.body as Record<string, unknown>), id })
        // accountId is immutable — a patch must not re-home the row to another company (ownsRow).
        if (!ownsRow(existing, merged.accountId)) {
          return reply.code(409).send({ error: 'That record belongs to a different company.' })
        }
        validateWrite(loadState(db), entity, merged)
        upsertRow(db, entity, merged)
        return reply.code(200).send(merged)
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    app.delete('/api/:entity/:id', (req, reply) => {
      const { entity, id } = req.params as { entity: string; id: string }
      if (!isKnownTable(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` })
      // Scope a scoped-table delete to its owning account — the server analog of the
      // client's MANDATORY findOwned guard. A scoped delete MUST assert an owning account:
      // omitting it can't prove ownership, so we refuse with 400 (rather than deleting by id,
      // which was a tenant-guard bypass). A wrong owner is 404. Accounts are top-level and
      // carry no accountId, so they delete by id.
      const { accountId } = req.query as { accountId?: string }
      try {
        if (isScopedTable(entity)) {
          if (accountId === undefined) {
            return reply.code(400).send({ error: 'accountId is required to delete a scoped record.' })
          }
          if (!ownsRow(getRow(db, entity, id), accountId)) {
            return reply.code(404).send({ error: 'Not found' })
          }
        }
        deleteRow(db, entity, id) // idempotent
        return reply.code(204).send()
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    // Transactional batch write — the verb the client sync adapter uses for every save.
    // Body: { ops: BatchOp[] }, already ordered (upserts parent-first, then deletes
    // child-first; see the client's syncOps.diffOps). The whole list is applied in ONE
    // transaction: all-or-nothing. This is what makes a reparent+delete safe — the
    // re-binding upsert commits before the old parent's DELETE cascades, so the cascade
    // finds nothing to take — and guarantees a mid-batch failure rolls back, leaving the
    // prior data intact. Each op reuses the SAME ownsRow / sanitizeWrite / validateWrite the
    // per-entity routes use; loadState() inside the tx reflects earlier ops, so a child
    // validates against the parent a sibling op just upserted.
    app.post('/api/batch', (req, reply) => {
      const body = req.body as { ops?: unknown }
      if (!body || !Array.isArray(body.ops)) {
        return reply.code(400).send({ error: 'ops array is required' })
      }
      const ops = body.ops as BatchOp[]
      try {
        tx(db, () => {
          for (const op of ops) {
            const { method, table, id } = op
            if (typeof table !== 'string' || typeof id !== 'string') {
              throw new ValidationError('Each op needs a string table and id.')
            }
            if (!isKnownTable(table)) throw new ValidationError(`Unknown entity: ${table}`)
            if (method === 'PUT') {
              const row = op.row
              if (!row || typeof row !== 'object' || (row as { id?: unknown }).id !== id) {
                throw new ValidationError('Each PUT op needs a row whose id matches the op id.')
              }
              // accountId is immutable (ownsRow): a write must not re-home an existing row.
              const existing = getRow(db, table, id)
              if (!ownsRow(existing, (row as { accountId?: unknown }).accountId)) {
                throw new ValidationError('That record belongs to a different company.')
              }
              const clean = sanitizeWrite(table, row as Record<string, unknown>)
              validateWrite(loadState(db), table, clean)
              upsertRow(db, table, clean)
            } else if (method === 'DELETE') {
              // Scoped deletes assert ownership (same rule as the DELETE route).
              if (isScopedTable(table)) {
                if (typeof op.accountId !== 'string') {
                  throw new ValidationError('accountId is required to delete a scoped record.')
                }
                if (!ownsRow(getRow(db, table, id), op.accountId)) {
                  throw new ValidationError('That record belongs to a different company.')
                }
              }
              deleteRow(db, table, id)
            } else {
              throw new ValidationError(`Unknown op method: ${String(method)}`)
            }
          }
        })
        return reply.code(200).send({ ok: true, applied: ops.length })
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    // Bulk import into one account, reusing the SAME remap+validate+sanitize the store
    // runs (shared/domain/mutations.remapAndValidateImport). Body: { accountId, data }.
    // `data` may be a raw export ({schemaVersion,data} or bare AppData); parseData
    // applies the shape guard + MAX_IMPORT_RECORDS cap + migration.
    app.post('/api/import', (req, reply) => {
      const body = req.body as { accountId?: string; data?: unknown }
      if (!body || typeof body.accountId !== 'string') {
        return reply.code(400).send({ error: 'accountId is required' })
      }
      let incoming
      try {
        incoming = parseData(JSON.stringify(body.data ?? {}))
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Invalid import data' })
      }
      // remapAndValidateImport drops/repairs dangling refs so the slice is FK-clean
      // before it hits SQLite; the try/catch is defence-in-depth so any residual DB
      // constraint failure becomes a 400 (via fail's classification) rather than an
      // uncaught 500.
      try {
        const result = remapAndValidateImport(loadState(db), body.accountId, incoming, new Date().toISOString())
        // Refuse a zero-record import rather than wiping the account's slice (mirrors the
        // client store guard — replacing a company's data with nothing is never intended).
        if (result.imported > 0) replaceAccountSlice(db, body.accountId, result.data)
        return { imported: result.imported, skipped: result.skipped, maxRecords: MAX_IMPORT_RECORDS }
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    // Test-only: wipe (and optionally re-seed) so E2E/integration runs start clean.
    app.post('/api/test/reset', (req, reply) => {
      if (!opts.allowReset) return reply.code(403).send({ error: 'reset disabled' })
      const body = (req.body ?? {}) as { seed?: boolean }
      wipe(db)
      if (body.seed) insertAll(db, seed())
      return { ok: true }
    })
  })

  return app
}
