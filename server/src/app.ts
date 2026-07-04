import { randomBytes, timingSafeEqual } from 'node:crypto'
import Fastify from 'fastify'
import rateLimitPlugin from '@fastify/rate-limit'
import helmetPlugin from '@fastify/helmet'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { DEMO_USER, type Auth, type AuthMode, type SessionUser } from './auth'
import { betterAuthAdapter, type AuthAdapter } from './authAdapter'

// The identity requireUser attaches to every gated request. Session/identity
// plumbing ONLY — accountId stays client-asserted (ownsRow is still the tenant guard);
// this is the seam Stage C will later use to derive accountId server-side.
declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null
  }
}
import { parseData, MAX_IMPORT_RECORDS } from '@capacitylens/shared/data/transfer'
import type { Resource, Client, Project } from '@capacitylens/shared/types/entities'
import { remapAndValidateImport, findOwned } from '@capacitylens/shared/domain/mutations'
// P2.5a lifecycle wiring: the PURE state machine (transitions + the purge eligibility predicate +
// the resource-PII scrub) and the PURE delete cascades, COMPOSED by the lifecycle routes below. The
// server owns the clock (passes nowISO in); it never re-derives these rules — single-sourced in shared.
import {
  archive,
  unarchive,
  softDelete,
  canPurge,
  obfuscateResource,
  isLifecycleEntityKey,
  type LifecycleEntityKey,
} from '@capacitylens/shared/domain/lifecycle'
import {
  deleteResourceCascade,
  deleteProjectCascade,
  deleteClientCascade,
} from '@capacitylens/shared/lib/integrity'
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
import { sqliteTenantStore } from './tenantStore'
import { listAccounts, resolveRole } from './membership'
import {
  countOwners,
  createInvite,
  getInvite,
  getMemberRole,
  getUsersByIds,
  listInvitesForAccount,
  listMembersForAccount,
  listMembershipsForUser,
  looksLikeEmail,
  markInviteUsed,
  newInviteId,
  normalizeEmail,
  preauthInviteAllows,
  removeMember,
  revokeInvite,
  upsertMember,
  type Invite,
} from './controlTables'
// P2.6b per-tenant DELETE + member-PII erasure — the SINGLE permissioned path that wipes an account's
// PII everywhere (scoped AppData via FK cascade, the control tables, AND Better Auth user/account/session).
// Called ONLY from the two 'purge'-gated delete vectors below. eraseAccount opens its own tx; the batch
// (already inside tx) uses eraseAccountInTx (node:sqlite has no nested BEGIN).
import { eraseAccount, eraseAccountInTx } from './erasure'
import {
  can,
  canManageMemberRole,
  canRemoveMember,
  canSeeTimeOffNote,
  type Action,
  type Role,
} from '@capacitylens/shared/domain/access'
import { tx } from './txn'
import { newId } from '@capacitylens/shared/lib/id'
import { buildInternalClient, isBuiltinClient } from '@capacitylens/shared/data/internalClient'
import { type AuditRecord, type AuditSink, noopAuditSink } from './audit'

// ~5 MB request cap. A normal account is far smaller; an over-cap body is rejected
// by Fastify with 413 before our handlers run (mirrors the client's import guard).
const BODY_LIMIT = 5 * 1024 * 1024

// Fastify defaults BOTH to 0 (disabled). The documented deploy fronts this server with Nginx,
// which buffers/queues the client connection — 30s is generous headroom for that hop, and it's
// the guard that protects the documented DIRECT-EXPOSURE mode (no reverse proxy) from a
// slowloris-style slow-body/slow-read socket exhaustion attack that an unbounded timeout permits.
const REQUEST_TIMEOUT_MS = 30_000
const CONNECTION_TIMEOUT_MS = 30_000

/** Default invite lifetime (P1.9): a link with no explicit `expiresAt` in the create body expires
 *  7 days after it is minted. A short-ish default keeps a leaked/forgotten link from staying live
 *  indefinitely; a caller can shorten it via the body's `expiresAt`. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

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
  /** CAPACITYLENS_AUTH: 'off' (the default) means Better Auth does not exist here —
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
  /** CAPACITYLENS_MULTI_ACCOUNT=1 — allow more than one company (`accounts` row) to exist on this
   *  instance. Default false: CapacityLens is deliberately single-company-per-instance (see
   *  CLAUDE.md's product positioning) — once the `accounts` table holds ≥1 row, every vector that
   *  would CREATE a new one (POST /api/accounts, a PUT/batch-PUT whose id has no existing row,
   *  POST /api/orgs) is refused with a 403 naming this flag (see accountCreateCapped /
   *  SINGLE_COMPANY_CAP_MESSAGE), REGARDLESS of authMode — even 'off', which is otherwise
   *  trusted-local allow-all: this is a DEPLOYMENT-SHAPE policy, not an authz rule, so it gets no
   *  off-mode bypass. It also does NOT bypass for the bootstrap token below — that decides WHO may
   *  create an account, not WHETHER one may exist. UPDATE/PATCH/DELETE of an EXISTING account are
   *  never affected: the cap is create-time only, so a genuinely multi-company instance (this flag
   *  on, or a DB seeded before the cap existed) keeps serving normally. */
  multiAccount?: boolean
  /** CAPACITYLENS_BOOTSTRAP_TOKEN (P1.8) — a shared secret that, when sent as the
   *  `x-capacitylens-bootstrap-token` request header on `POST /api/orgs`, authorises
   *  constrained org-creation even for a caller who is NOT yet an Owner/Admin of any
   *  account (e.g. an operator provisioning the SECOND account on an instance that already
   *  has one). DEFAULT undefined = the token path is DISABLED: an unset/empty token can
   *  never match, so `POST /api/orgs` then allows ONLY first-run (zero accounts) or an
   *  existing Owner/Admin (or OFF mode). The compare is constant-time + length-checked so
   *  it leaks neither the token's length nor its bytes by timing. NOTE: the token now
   *  PRESUMES a multi-account instance — it only ever matters once opts.multiAccount is
   *  also true, since the single-company cap above denies EVERY create (token or not)
   *  while the instance is capped to one company. */
  bootstrapToken?: string
  /** CAPACITYLENS_HTTPS=1 — the API is reached over HTTPS, so HSTS is safe to emit.
   *  Default false: HSTS (Strict-Transport-Security) is ONLY valid over HTTPS and is
   *  actively HARMFUL over plain HTTP — a browser that caches an HSTS directive received
   *  on http:// would force https:// on a host that has no TLS, breaking it. This server
   *  typically runs HTTP behind a TLS-terminating proxy (Nginx), so the operator must
   *  OPT IN once TLS truly fronts the public origin. Off ⇒ helmet emits no HSTS header;
   *  all other helmet baseline headers (nosniff, CSP, Referrer-Policy, X-Frame-Options)
   *  are on regardless, as they are pure improvements with no HTTPS precondition. */
  https?: boolean
  /** CAPACITYLENS_AUDIT (P1.15) — the append-only JSONL audit sink. ON-by-default is decided at
   *  the index.ts layer (which builds a fileAuditSink from env, or a noop when =off); THIS factory
   *  defaults to noopAuditSink() so tests AND the default local/no-server deploy are byte-identical
   *  unless a real sink is explicitly injected. NEVER pass a row/body into the sink — only the
   *  typed AuditRecord whose changedFields are field NAMES (the #1 no-PII invariant). */
  audit?: AuditSink
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

// P1.9: mask the bearer token in the invite-accept URL before it reaches the access log. The token
// is the ONLY path-borne secret in the API; every other URL passes through unchanged. Anchored to
// the exact `/api/invites/<token>/accept` shape (optionally with a query string) so a normal path
// is never mangled. The match is on the path-with-query string pino logs (req.url).
const INVITE_ACCEPT_URL_RE = /^(\/api\/invites\/)[^/?#]+(\/accept(?:[?#].*)?)$/
// `url` is typed unknown because the serializer may also run over a hand-built `{ req: {...} }`
// record (e.g. app.log.info(...)) whose url is absent; a non-string passes through untouched.
const redactInviteTokenUrl = (url: unknown): string | undefined =>
  typeof url === 'string' ? url.replace(INVITE_ACCEPT_URL_RE, '$1[redacted]$2') : undefined

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

// Request-validation guard for the invite-create role (P1.9). A bad/missing role is a CALLER fault
// (400), distinct from createInvite's loud throw (a 500-tier integrity backstop for a role that
// somehow slipped past here). Mirrors the closed Role vocabulary in shared/domain/access.
const INVITE_ROLES: readonly Role[] = ['owner', 'admin', 'editor', 'viewer']
const isKnownRole = (value: unknown): value is Role =>
  typeof value === 'string' && (INVITE_ROLES as readonly string[]).includes(value)

// A table is "scoped" (tenant-owned) when it carries an accountId column — every table
// except top-level `accounts`. Scoped deletes must assert ownership via accountId.
const isScopedTable = (entity: keyof typeof TABLES): boolean =>
  TABLES[entity].columns.some((c) => c.name === 'accountId')

// The ONLY three entities that carry the lifecycle tombstones (archivedAt/deletedAt, P2.1) and so can
// run the archive/unarchive/soft-delete/purge routes (P2.5a). A guard, not a free string compare, so a
// lifecycle handler can `entity is LifecycleEntity`-narrow before indexing AppData[entity] — and any
// other table (phases/activities/allocations/timeOff/disciplines/accounts) is a 404 on these routes.
// Single-sourced in shared (LIFECYCLE_ENTITY_KEYS) so this route allow-list and validate.ts's
// sanitizeWrite tombstone-pin can't drift; aliased to the local names the handlers below already use.
type LifecycleEntity = LifecycleEntityKey
const isLifecycleEntity = isLifecycleEntityKey

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

// The three Account fields that are SET once, at company creation, and FROZEN thereafter (P1.14):
// language, week-start and time zone are calendar/locale facts the whole team relies on, so the
// app captures them in the create-company form and disables them in Settings. The server is the
// real boundary — the disabled UI is only UX.
const IMMUTABLE_ACCOUNT_FIELDS = ['language', 'weekStartsOn', 'timezone'] as const

/**
 * True when an accounts write would CHANGE a frozen field (P1.14) — the violation signal the
 * PUT/PATCH/batch handlers turn into a 409 (per-route) / 400 (batch).
 *
 * Reports a violation ONLY when `existing` is defined AND, for some frozen field, the field is
 * PRESENT in `incoming` AND its incoming value differs from the stored one. Two deliberate rules:
 *  - Change, not presence: the sync adapter re-sends the WHOLE row on any edit (e.g. a rename),
 *    so an unchanged frozen value MUST pass — only a real change is a violation.
 *  - No existing row → creation, when these values are legitimately SET → never a violation.
 *
 * @param existing the stored row (undefined on a create — always passes)
 * @param incoming the wire body whose frozen fields are checked (the PUT body / PATCH req.body —
 *   NOT a merged row, which would already have overwritten `existing` and so never detect a change)
 */
function accountFieldsFrozen(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): boolean {
  if (!existing) return false
  return IMMUTABLE_ACCOUNT_FIELDS.some(
    (field) => field in incoming && incoming[field] !== existing[field],
  )
}

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

// Constant-time secret compare for the P1.8 bootstrap token. Returns false UNLESS the
// configured token is a non-empty string AND the presented header is a non-empty string of
// the SAME byte length whose bytes match — so an unset/empty token (the default) never allows
// the token path, and the length-equality short-circuit doesn't reveal the secret's length by
// timing (timingSafeEqual itself requires equal-length buffers). The header arrives as
// string | string[] | undefined from Fastify; only a single string can match.
function bootstrapTokenMatches(configured: string | undefined, presented: unknown): boolean {
  if (!configured || typeof presented !== 'string' || presented.length === 0) return false
  const a = Buffer.from(configured, 'utf8')
  const b = Buffer.from(presented, 'utf8')
  // timingSafeEqual throws on a length mismatch — guard first; an attacker learns only "wrong
  // length" (already observable from the response), not the secret's bytes.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// Single-company-per-instance cap (owner policy — see AppOptions.multiAccount / CLAUDE.md). The
// deployment defaults to hosting exactly ONE company; every route that could add a SECOND
// `accounts` row shares this one predicate so the rule can't drift between POST/PUT/batch/orgs.
const SINGLE_COMPANY_CAP_MESSAGE =
  'This instance allows a single company. Set CAPACITYLENS_MULTI_ACCOUNT=1 to allow more.'

/** SELECT COUNT(*) FROM accounts — the cap's sole precondition. Same query POST /api/orgs used
 *  before the cap existed; kept as one function so every enforcement point reads the identical
 *  number (never re-derived ad hoc at each call site). */
function countAccounts(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n
}

/**
 * True when creating a NEW `accounts` row right now would violate the single-company cap: the
 * table already holds ≥1 row AND the instance has not opted into `multiAccount`. Callers MUST call
 * this only for the CREATE case (no existing row) — an UPDATE/DELETE of an already-existing account
 * is never capped; enforcement is create-time only, per AppOptions.multiAccount.
 */
function accountCreateCapped(db: Db, opts: AppOptions): boolean {
  return !opts.multiAccount && countAccounts(db) > 0
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
  // P0.5.8: build the provider-neutral session-verify port ONCE. requireUser + /api/auth/me
  // depend only on this AuthAdapter, never on Better Auth directly. In 'off' mode no adapter
  // is built (and `auth` is already null), so Better Auth is never touched — the OFF guarantee.
  const authAdapter: AuthAdapter | null = auth ? betterAuthAdapter(auth) : null
  const logOn = opts.log === true
  const app = Fastify({
    bodyLimit: BODY_LIMIT,
    requestTimeout: REQUEST_TIMEOUT_MS,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    // CAPACITYLENS_LOG=1 turns on Fastify's bundled pino (JSON to stdout; no new dependency).
    // ON always attaches the redact config (both branches) so a secret can never reach the
    // logs — see LOG_REDACT_PATHS. Off ⇒ logger disabled entirely — today's behaviour, byte for byte.
    logger: logOn
      ? {
          ...(opts.logStream ? { stream: opts.logStream } : {}),
          redact: { paths: LOG_REDACT_PATHS, remove: true },
          // P1.9 access-log hygiene: the invite-accept URL carries the bearer token in the path
          // (`/api/invites/<token>/accept`), and pino logs req.url VERBATIM (only headers are
          // redacted via redact above). Rewrite just that one URL shape to mask the :token segment
          // so the live token never reaches stdout under CAPACITYLENS_LOG. All other URLs pass
          // through untouched. This is REQUEST-log hygiene — entirely separate from the P1.15 audit
          // sink. The default Fastify req serializer is reconstructed so method/hostname/remote
          // address keep logging exactly as before.
          serializers: {
            req(req: FastifyRequest) {
              return {
                method: req.method,
                url: redactInviteTokenUrl(req.url),
                hostname: req.hostname,
                remoteAddress: req.ip,
                remotePort: req.socket?.remotePort,
              }
            },
          },
        }
      : false,
  })
  // Fail-closed: an omitted corsOrigin locks to the localhost allow-list, NOT a wildcard.
  const corsOrigin = opts.corsOrigin ?? DEFAULT_CORS
  // 500s with logging ON go through the request-scoped logger (one parseable JSON line,
  // correlated with the request); OFF keeps today's bare console.error.
  const sendFail = (reply: FastifyReply, err: unknown) =>
    fail(reply, err, logOn ? (e: unknown) => reply.log.error(e) : undefined)

  /**
   * Error classifier for the P2.5a lifecycle routes. The pure state machine (archive/unarchive/
   * softDelete in shared/domain/lifecycle.ts) THROWS a plain `Error` whose message starts with
   * `Cannot archive`/`Cannot unarchive`/`Cannot delete` on an ILLEGAL TRANSITION (e.g. soft-deleting a
   * row that was never archived). That is a CALLER state conflict — a 409 carrying the machine's own
   * authored, display-safe message — NOT a 500, and NOT the same as findOwned's cross-account
   * integrity throw (`That record does not belong…`) or any unexpected error, which still route through
   * sendFail (the generic redaction funnel). Anchored to the three `Cannot <verb>` prefixes so only the
   * lifecycle machine's deliberate guard-throws map to 409; everything else is left to sendFail.
   */
  const lifecycleFail = (reply: FastifyReply, err: unknown): FastifyReply => {
    if (err instanceof Error && /^Cannot (archive|unarchive|delete)/.test(err.message)) {
      return reply.code(409).send({ error: err.message })
    }
    return sendFail(reply, err)
  }

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

  // requireUser — ONE gate for everything under /api/ except /api/health (the
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
      const user = await authAdapter!.verifySession(toWebHeaders(req.headers))
      if (!user) return reply.code(401).send({ error: 'Sign in to continue.' })
      req.user = user
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

  // The audit sink (P1.15). Defaults to noopAuditSink() so the default deploy + every test are
  // byte-identical unless index.ts injects a real fileAuditSink (ON by default in server mode).
  const auditSink = opts.audit ?? noopAuditSink()

  // changedFields for an audit line = the wire body/row's field NAMES (never values). This is the
  // ONLY thing ever derived from a body for the audit trail — the #1 no-PII invariant.
  const fieldNames = (o: unknown): string[] =>
    o && typeof o === 'object' ? Object.keys(o as Record<string, unknown>) : []

  // Record one audit line and, ONLY on a write failure, set the uniform warning header. The header
  // (not a body field) is the warning mechanism on ALL six routes — it keeps entity row payloads
  // pure and works for the bodyless 204 DELETE. append() never throws (see audit.ts), so this can't
  // fail a request: a degraded audit is a soft signal (deep-health latches it), not a 5xx.
  const audit = (reply: FastifyReply, record: AuditRecord): void => {
    if (!auditSink.append(record)) reply.header('x-capacitylens-audit-warning', 'true')
  }

  // The tenancy swap point (P1.4): the per-account scoped read/write seam every permissioned route
  // goes through. Built ONCE here (factory state, like healthStmt) so the same instance backs every
  // request. Today it wraps the shared SQLite file; a future per-agency-DB / Postgres backend swaps
  // inside tenantStore.ts with no route change. See tenantStore.ts for the no-cross-tenant contract.
  const store = sqliteTenantStore(db)

  /**
   * The authorization seam (P1.5 requirePermission): "may THIS request perform `action` on
   * `accountId`?". Returns `true` to proceed; otherwise it has already sent a 403 and returns
   * `false`, so a caller guards with `if (!authorize(...)) return`.
   *
   * OFF mode (the default, trusted-local) is a NO-OP allow-all: it returns `true` on the FIRST line,
   * BEFORE any membership read — `req.user` is the synthetic DEMO_USER and `resolveRole`/`can` never
   * run. This pins the #1 invariant (OFF = exactly today's behaviour). Auth-on resolves the caller's
   * membership role for `accountId` and runs the pure `can(role, action)` matrix:
   *   - non-member (`resolveRole === null`) → 403,
   *   - member but insufficient tier (`can === false`) → 403,
   *   - otherwise allowed.
   *
   * No 401/503 here: the requireUser preHandler already 401'd a session-less request (and 503'd an
   * auth-backend failure) upstream, so by the time a handler runs in auth-on, `req.user` is a real
   * verified session user. The 403 uses the repo's standard `{ error }` JSON shape.
   *
   * @param req        The (already-authenticated in auth-on) request; `req.user` is the principal.
   * @param reply      The reply, used to send the 403 on denial.
   * @param accountId  The account the action targets (each route derives this as it does today).
   * @param action     The coarse capability being attempted (see {@link Action}).
   * @returns `true` if allowed; `false` after sending a 403 if denied.
   */
  function authorize(
    req: FastifyRequest,
    reply: FastifyReply,
    accountId: string,
    action: Action,
  ): boolean {
    if (authMode === 'off') return true // OFF = allow-all; resolveRole/can NEVER run.
    const role = resolveRole(db, req.user!, accountId)
    if (role === null) {
      reply.code(403).send({ error: 'Forbidden.' }) // not a member of this account
      return false
    }
    if (!can(role, action)) {
      reply.code(403).send({ error: 'Forbidden.' }) // member, but role tier too low for action
      return false
    }
    return true
  }

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
        // P1.15: audit-degraded is a SOFT signal — keep ok:true (the DB is fine; the audit sink
        // failing a write doesn't make the server unhealthy), just surface 'degraded' so an
        // operator can see it. The SHALLOW (non-deep) health stays exactly { ok: true } above —
        // the Playwright webServer probe contract — so the audit field appears ONLY in deep mode.
        return { ok: true, db: true, audit: auditSink.degraded ? 'degraded' : 'ok' }
      } catch {
        // INTENTIONAL empty catch: the 503 IS the surfacing. A broken DB must make the uptime
        // monitor see 503 — not a lying { ok: true } 200, and not a thrown 500. Do NOT "fix" this
        // by logging-and-rethrowing; the status code is the signal the monitor needs.
        return reply.code(503).send({ ok: false })
      }
    })

    // Thin identity route — exists in EVERY mode so the client never forks on a
    // flag: { authMode, user }. 'off' reports the demo identity unconditionally; other
    // modes report the Better Auth session user, or 401 (with authMode, so the login
    // screen knows which form to show) when there is no session.
    app.get('/api/auth/me', async (req, reply) => {
      // Single-company cap capability flags (see AppOptions.multiAccount): the client's
      // create-company entry point uses these to hide/disable itself instead of discovering the cap
      // via a failed POST. Recomputed PER REQUEST (accountCount changes as companies are created) —
      // never cached — and carried on BOTH success shapes (off + authed) so neither mode forks the
      // client. The 401/503 shapes below are deliberately unchanged (no account facts for a caller
      // who isn't authenticated / whose session state is unknown).
      const capFields = {
        multiAccount: opts.multiAccount === true,
        canCreateAccount: opts.multiAccount === true || countAccounts(db) === 0,
      }
      if (authMode === 'off') return { authMode, user: DEMO_USER, ...capFields }
      try {
        const user = await authAdapter!.verifySession(toWebHeaders(req.headers))
        if (!user) return reply.code(401).send({ authMode, error: 'Sign in to continue.' })
        return { authMode, user, ...capFields }
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

    // The login → account list that drives the AccountPicker (P1.13). OFF mode is trusted-local:
    // EVERY account is accessible, so return all summaries with NO membership gate — branch on
    // authMode === 'off' BEFORE touching membership (the OFF guarantee). Auth-on returns ONLY the
    // caller's memberships via listAccounts. Returns AccountSummary[] = [{ id, name, role }].
    app.get('/api/accounts', (req) => {
      if (authMode === 'off') {
        // No membership in off mode: every account is visible. Map to the same AccountSummary shape
        // listAccounts returns ({ id, name, role }) so the auth-on / auth-off shapes are identical on
        // the wire. The role is 'owner' — the trusted-local full-access sentinel: OFF is byte-identical
        // to today's no-login deploy, so the client's pure `can('owner', …)` keeps OFF fully editable
        // (and a Viewer read-only mode is reachable ONLY auth-on, where a real membership role exists).
        return loadState(db).accounts.map((a) => ({ id: a.id, name: a.name, role: 'owner' as const }))
      }
      return listAccounts(db, req.user!)
    })

    // Whole-state read backs the client's PersistenceAdapter.loadAll(). Only WRITES are entity-level;
    // reads stay whole-tree so hydration is one round-trip.
    //
    // P1.4: when `?accountId=` is PRESENT, return that account's scoped slice via the TenantStore
    // (OFF mode: no gate — trusted-local; auth-on: a thin membership-existence guard — resolveRole
    // null ⇒ 403, so auth-on can't cross-tenant-read; the richer per-action can() gate is P1.5).
    app.get('/api/state', (req, reply) => {
      const { accountId } = req.query as { accountId?: string }
      if (accountId !== undefined) {
        if (typeof accountId !== 'string' || accountId.length === 0) {
          return reply.code(400).send({ error: 'accountId must be a non-empty string.' })
        }
        // Refuse a cross-tenant read before any data leaves the DB. The authorize seam is the
        // single source of truth: OFF mode short-circuits to allow-all (trusted-local), auth-on
        // requires membership (read = any member, via can()) and 403s a non-member.
        if (!authorize(req, reply, accountId, 'read')) return
        // P1.6 field-level redaction: the time-off `note` is owner/admin-only. Decide visibility from
        // the caller's role and redact it SERVER-SIDE so it never serializes for an Editor/Viewer.
        // OFF mode = trusted-local ⇒ include. Auth-on: owner/admin include, editor/viewer omit.
        // resolveRole is non-null here (authorize('read') already proved membership); the `role !==
        // null` guard is belt-and-braces / fail-closed (an unexpected null omits the note, never leaks).
        const role = authMode === 'off' ? null : resolveRole(db, req.user!, accountId)
        const includeTimeOffNote = authMode === 'off' || (role !== null && canSeeTimeOffNote(role))
        // P2.5a admin "Archived & deleted" read. `?includeInactive=1` asks for the FULL slice
        // (archived + soft-deleted rows retained), which is privileged: it is gated at the SAME tier as
        // purge (admin+, `can(role, 'purge')`) — the lifecycle-management tier — so an editor/viewer
        // cannot pull tombstones. OFF mode is trusted-local ⇒ always allowed. A non-admin who asks for
        // the flag gets 403 (not a silent fall-back to the active-only read — surface the refusal so the
        // client knows the admin view is off-limits, mirroring authorize's explicit 403).
        //
        // P2.6 COMPLETE PER-TENANT EXPORT. This same admin/'purge'-gated `?includeInactive=1` read IS
        // the roadmap's "complete per-tenant backup": exactly ONE account's slice (the accountId guard
        // above), retaining archived + soft-deleted rows so nothing is silently dropped from the backup
        // — UNLIKE the client's active-only "Export JSON" (P2.4), which projects via activeOnly and so
        // omits tombstones. The server-control tables (account_members / invites / Better Auth user|
        // session|account) are STRUCTURALLY excluded: readSlice only ever reads `accounts` + the scoped
        // tables, never the control plane, so membership/invite secrets/PII can never ride the export.
        // Locked by app.export.test.ts. Doc-only note — no behaviour change to this route.
        const wantsInactive = (req.query as { includeInactive?: string }).includeInactive === '1'
        if (wantsInactive && authMode !== 'off' && !(role !== null && can(role, 'purge'))) {
          return reply.code(403).send({ error: 'Forbidden.' })
        }
        // P2.4: the NORMAL app read HIDES archived/soft-deleted resources/clients/projects — pass
        // includeInactive:false so readSlice drops them server-side (the same rule the client views
        // apply via useActiveScopedData). The P2.5a admin read passes true to retain them.
        return store.readSlice(accountId, { includeTimeOffNote, includeInactive: wantsInactive })
      }
      // No ?accountId=. The auth-on cross-tenant whole-read is now CLOSED (P1.13 — the P1.4
      // carry-forward): a logged-in user must hydrate PER ACCOUNT via ?accountId= (the client picker
      // → GET /api/accounts → GET /api/state?accountId=). Returning the whole DB to any authed user
      // was a tenant-isolation leak; 400 it. OFF mode is trusted-local, so it RETAINS the whole read
      // (db-helpers, the OFF db-backed e2e, and the OFF app.accounts tests all rely on it). The client
      // adapter treats this 400 on the NO-ARG read as "hydrate empty, show the picker" (see
      // ServerSyncAdapter.loadAll), so a no-arg bootstrap in auth-on lands on the picker, not an error.
      if (authMode !== 'off') {
        return reply.code(400).send({ error: 'accountId is required.' })
      }
      // OFF: trusted-local whole read RETAINED. (P1.6 note: this whole read does NOT redact the
      // time-off `note` — fine, OFF is trusted-local and includes it everywhere.)
      return loadState(db)
    })

    // "has this dataset ever been initialised" (persistent marker), NOT "is it currently
    // non-empty" — so a user who deletes all their data isn't re-seeded on the next load
    // (the bug was: an emptied dataset reported hasData:false and got the demo seed back).
    app.get('/api/meta', () => ({ hasData: isInitialized(db) }))

    // Constrained org-creation (P1.8): the ATOMIC "create a usable account" path, distinct from the
    // generic `POST /api/accounts` below (which stays OPEN for the not-yet-migrated onboarding client
    // and only ever writes the bare account row — closing it is deferred to the client migration,
    // P1.13). Unlike that bare write, /api/orgs ALSO mints the account's built-in Internal client and
    // makes the caller its Owner, in ONE transaction.
    //
    // AUTHORIZATION (computed BEFORE any write). Two SEPARATE gates, both must pass:
    //
    //   GATE 0 — the single-company cap (WHETHER a new company may exist at all; see
    //   AppOptions.multiAccount). Checked FIRST, ahead of `allowed` below, so a denied caller sees
    //   the actionable cap message rather than the generic 'Forbidden.' `allowed` would send. Not
    //   bypassed by OFF mode or the bootstrap token — see the cap's own doc comment.
    //
    //   GATE 1 — `allowed` (WHO may create it, once GATE 0 permits). Allowed iff ANY of:
    //   (1) ZERO accounts exist — first-run bootstrap (anyone may create the very first org; this
    //       is also the only case GATE 0 lets through by default, so it's the common path).
    //   (2) OFF mode (trusted-local) — mirrors the authorize() OFF no-op; req.user is DEMO_USER.
    //   (3) auth-on: the caller is an ACTIVE Owner/Admin of SOME existing account (can(role,
    //       'manageMembers') = admin-tier) — an existing operator may provision more orgs.
    //   (4) a valid bootstrap token in the `x-capacitylens-bootstrap-token` header (opts.bootstrapToken,
    //       env CAPACITYLENS_BOOTSTRAP_TOKEN, OFF by default — disabled when unset/empty).
    // Otherwise 403 — the acceptance criterion: a STRANGER cannot create an org once any account
    // exists, absent a bootstrap token. The gate runs in auth-on AND off; in off mode (1)/(2) already
    // allow, so the token/membership branches are moot there.
    app.post('/api/orgs', (req, reply) => {
      const accountCount = (db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n
      // GATE 0 — see the comment block above. `!opts.multiAccount && accountCount > 0` mirrors
      // accountCreateCapped exactly (inlined here since accountCount is already in hand).
      if (!opts.multiAccount && accountCount > 0) {
        return reply.code(403).send({ error: SINGLE_COMPANY_CAP_MESSAGE })
      }
      const allowed =
        accountCount === 0 || // (1) first-run bootstrap
        authMode === 'off' || // (2) trusted-local — req.user is DEMO_USER
        bootstrapTokenMatches(opts.bootstrapToken, req.headers['x-capacitylens-bootstrap-token']) || // (4)
        // (3) an ACTIVE owner/admin of ANY existing account (admin-tier = can manageMembers).
        listMembershipsForUser(db, req.user!.id).some(
          (m) => m.status === 'active' && can(m.role, 'manageMembers'),
        )
      if (!allowed) {
        return reply.code(403).send({ error: 'Forbidden.' })
      }
      // Build a VALID account row from the body (name required; colour repaired; junk schedulingMode
      // dropped) via the SAME sanitize/validate the generic account create uses — so /api/orgs can't
      // persist a row the generic path would reject. The id is generated server-side when the body
      // omits one (the org-create caller need not mint it, unlike the entity sync path); a provided id
      // is accepted and validated like any other write.
      try {
        const now = new Date().toISOString()
        const id = typeof (req.body as { id?: unknown })?.id === 'string' && (req.body as { id: string }).id.trim() !== ''
          ? (req.body as { id: string }).id
          : newId()
        const accountRow = sanitizeWrite('accounts', {
          ...(req.body as Record<string, unknown>),
          id,
          createdAt: now,
          updatedAt: now,
        })
        validateWrite(loadState(db), 'accounts', accountRow)
        // Atomic: the account, its built-in Internal client, and the Owner membership commit together
        // or not at all (tx rolls back on any throw). Minting the Internal here is correct precisely
        // because an /api/orgs caller does NOT separately sync one (so there is no second builtin to
        // collide — the account is brand-new, freshly inserted in this same tx). The OFF-mode owner is
        // DEMO_USER (id 'demo'); the membership table is not gated/read in off mode, so the row is
        // harmless bookkeeping there.
        tx(db, () => {
          insertRow(db, 'accounts', accountRow)
          insertRow(db, 'clients', buildInternalClient(id, now) as unknown as Record<string, unknown>)
          upsertMember(db, {
            accountId: id,
            userId: req.user!.id,
            role: 'owner',
            status: 'active',
            createdAt: now,
          })
        })
        return reply.code(201).send(accountRow)
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    // Invite CREATE (P1.9): mint a single-use, expiring link that pre-sets a role for `accountId`.
    // Body: { accountId, role, expiresAt? }. GATED 'manageInvites' (admin+ of THAT account) via the
    // same authorize seam every permissioned route uses — OFF mode is the allow-all no-op (the token
    // is minted as DEMO_USER's act), auth-on requires admin-tier membership of `accountId` (a
    // cross-tenant stranger → 403). The token is a 32-byte CSPRNG value, base64url-encoded; it is the
    // ONLY secret here, so it is NEVER logged (it's returned in the body to the authorised caller and
    // nowhere else).
    //
    // P1.10 — an optional `preauthEmail` may be attached: a non-empty, email-shaped value is stored
    // NORMALIZED (trim+lowercase) and turns this into a pre-authorised invite that the accept route
    // binds ONLY for a caller whose VERIFIED email matches it (see preauthInviteAllows). Absent/empty
    // ⇒ stored as null ⇒ a P1.9 link invite (any signed-in caller may accept). Nothing is ever
    // emailed — the admin still hands out the link; preauthEmail only narrows who may redeem it.
    app.post('/api/invites', (req, reply) => {
      const body = (req.body ?? {}) as {
        accountId?: unknown
        role?: unknown
        expiresAt?: unknown
        preauthEmail?: unknown
      }
      if (typeof body.accountId !== 'string' || body.accountId.length === 0) {
        return reply.code(400).send({ error: 'accountId must be a non-empty string.' })
      }
      if (!isKnownRole(body.role)) {
        return reply.code(400).send({ error: 'role must be one of owner, admin, editor, viewer.' })
      }
      // Shape-check preauthEmail here, BEFORE the authorize() gate below, so a malformed email is
      // rejected with 400 and never reaches the write. A non-string, or a
      // string that is empty after trim ⇒ link invite (null). A non-empty value MUST look like an
      // email (single '@', non-empty local+domain) — junk is a 400, never silently dropped (that
      // would mint a link invite the admin didn't intend, widening who may accept).
      let preauthEmail: string | null = null
      if (typeof body.preauthEmail === 'string') {
        const trimmed = body.preauthEmail.trim()
        if (trimmed.length > 0) {
          if (!looksLikeEmail(trimmed)) {
            return reply.code(400).send({ error: 'preauthEmail must be a valid email address.' })
          }
          preauthEmail = normalizeEmail(trimmed) // store normalized so accept compares normalized↔normalized
        }
      }
      // Gate BEFORE any write: admin+ of this account may create invites; a non-member/under-tier is 403.
      if (!authorize(req, reply, body.accountId, 'manageInvites')) return
      // OWNER-GRANT GUARD (P1.11): minting an `owner` invite is an ownership grant, so it requires the
      // caller be owner-tier — an admin (who passes manageInvites) must NOT be able to escalate to
      // owner by inviting one. This closes the admin→owner escalation via the invite path, mirroring
      // the pure canManageMemberRole "no admin→owner grant" rule on the direct role-change route. OFF
      // mode (trusted-local) skips it like every other gate — req.user is DEMO_USER, not a real owner.
      if (body.role === 'owner' && authMode !== 'off' && resolveRole(db, req.user!, body.accountId) !== 'owner') {
        return reply.code(403).send({ error: 'Only an owner can invite an owner.' })
      }
      // Honour a caller-supplied expiresAt ONLY when it parses to a FUTURE instant; otherwise fall
      // back to the 7-day default. A junk/past expiresAt silently degrading to the default (rather
      // than 400) keeps a malformed value from minting a born-expired link.
      const parsed = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN
      const expiresAt =
        Number.isFinite(parsed) && parsed > Date.now()
          ? new Date(parsed).toISOString()
          : new Date(Date.now() + INVITE_TTL_MS).toISOString()
      const token = randomBytes(32).toString('base64url')
      const now = new Date().toISOString()
      try {
        const invite: Invite = {
          token,
          // Non-secret handle (P1.11) — list/revoke key on this; the token stays write-once.
          id: newInviteId(),
          accountId: body.accountId,
          role: body.role,
          // null ⇒ P1.9 link invite (any signed-in caller); a normalized email ⇒ P1.10 preauth.
          preauthEmail,
          expiresAt,
          usedAt: null,
          createdAt: now,
        }
        createInvite(db, invite)
        // Echo back what the caller needs to build the link — NOT createdAt/usedAt. preauthEmail is
        // echoed (the admin set it; convenient confirmation of the NORMALIZED value), and only to this
        // already-authorised admin — it is never exposed on any read path (invites are off AppData).
        return reply
          .code(201)
          .send({ token, accountId: invite.accountId, role: invite.role, expiresAt, preauthEmail })
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    // Invite ACCEPT (P1.9): a signed-in caller redeems a link, binding the invited role to THEIR
    // membership. NO authorize() call — the membership is the OUTPUT of this route, not a precondition
    // (requireUser upstream already proved a real session, or attached DEMO_USER in OFF mode). The
    // token-state checks ARE the gate: unknown → 404, already-used → 409, expired → 410. P1.10 adds an
    // email-preauth gate AFTER those and BEFORE the bind: a non-null preauthEmail binds ONLY for a
    // VERIFIED caller whose verified email matches (else 403, nothing bound, nothing consumed). A null
    // preauthEmail is the P1.9 link path (any signed-in caller). On success the membership upsert and
    // the single-use stamp commit in ONE transaction (atomic bind), and markInviteUsed's
    // `usedAt IS NULL` clause double-guards single-use against a concurrent race.
    app.post('/api/invites/:token/accept', (req, reply) => {
      const { token } = req.params as { token: string }
      try {
        const invite = getInvite(db, token)
        if (!invite) return reply.code(404).send({ error: 'Invite not found.' })
        if (invite.usedAt !== null) {
          return reply.code(409).send({ error: 'This invite has already been used.' })
        }
        if (Date.now() > Date.parse(invite.expiresAt)) {
          return reply.code(410).send({ error: 'This invite has expired.' })
        }
        // P1.10 email-preauth gate. OFF mode (trusted-local) SKIPS it entirely — mirroring authorize's
        // OFF allow-all no-op and P1.9's OFF behaviour: there is no real verified session in off
        // (req.user is the synthetic DEMO_USER), so a preauth invite simply binds DEMO_USER as any
        // other invite would. Auth-on: the pure preauthInviteAllows decides — a non-null preauthEmail
        // requires emailVerified===true AND an exact (normalized) email match; a wrong-email OR an
        // unverified-but-matching caller is 403 with NO bind and NO mutation, so usedAt stays null and
        // the genuinely-matching caller can still accept later (single-use is NOT consumed by a 403).
        if (authMode !== 'off' && !preauthInviteAllows(invite.preauthEmail, req.user!)) {
          return reply
            .code(403)
            .send({ error: 'This invite is reserved for a different (verified) account.' })
        }
        const now = new Date().toISOString()
        // Atomic: the membership and the consume commit together or roll back together — a half-applied
        // accept (role bound but token still live, or token consumed with no membership) is impossible.
        tx(db, () => {
          upsertMember(db, {
            accountId: invite.accountId,
            userId: req.user!.id,
            role: invite.role,
            status: 'active',
            createdAt: now,
          })
          markInviteUsed(db, invite.token, now)
        })
        return reply.code(200).send({ accountId: invite.accountId, role: invite.role })
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    // ── Member management (P1.11) ────────────────────────────────────────────────────────────────
    // Owner/Admin list / change-role / revoke members of THEIR account, plus list / revoke outstanding
    // invites. Every route gates through the SAME authorize seam (cross-tenant → 403 automatically):
    // members under 'manageMembers', invites under 'manageInvites' (both admin-tier). The pure shared
    // guards (canManageMemberRole / canRemoveMember) decide who-may-touch-whom (no admin→owner grant,
    // admin can't touch an owner); the server ADDS the count-based LAST-OWNER protection (countOwners),
    // which needs DB I/O and so can't live in the pure layer. OFF mode (trusted-local) has no real
    // member model, so the list routes return empty and the mutate routes are inert no-ops — the UI is
    // hidden in OFF anyway, but the endpoints must not crash if called.

    // LIST members. Joins the membership rows with Better Auth user identity (name/email, read ONLY
    // here, only for this authorized admin). isSelf marks the caller's own row (the client derives its
    // role from it). A missing name/email degrades to null — never a throw.
    app.get('/api/accounts/:accountId/members', (req, reply) => {
      const { accountId } = req.params as { accountId: string }
      if (!authorize(req, reply, accountId, 'manageMembers')) return
      // OFF mode: no real member model (req.user is DEMO_USER, membership is unread) — return empty so
      // the shape is honest and nothing crashes. The UI is hidden in OFF, so this is belt-and-braces.
      if (authMode === 'off') return { members: [] }
      const members = listMembersForAccount(db, accountId)
      const identities = getUsersByIds(db, members.map((m) => m.userId))
      return {
        members: members.map((m) => {
          const who = identities.get(m.userId)
          return {
            userId: m.userId,
            role: m.role,
            status: m.status,
            createdAt: m.createdAt,
            name: who?.name ?? null,
            email: who?.email ?? null,
            isSelf: m.userId === req.user!.id,
          }
        }),
      }
    })

    // CHANGE a member's role. Body { role }. 400 bad role; 404 non-member; 403 by the pure guard
    // (no admin→owner grant, admin can't touch an owner); 403 LAST-OWNER (demoting the sole owner).
    app.patch('/api/accounts/:accountId/members/:userId', (req, reply) => {
      const { accountId, userId } = req.params as { accountId: string; userId: string }
      const body = (req.body ?? {}) as { role?: unknown }
      if (!isKnownRole(body.role)) {
        return reply.code(400).send({ error: 'role must be one of owner, admin, editor, viewer.' })
      }
      const nextRole = body.role
      if (!authorize(req, reply, accountId, 'manageMembers')) return
      try {
        const targetRole = getMemberRole(db, accountId, userId)
        if (targetRole === null) return reply.code(404).send({ error: 'Not a member of this account.' })
        // OFF mode short-circuited authorize to allow-all, so resolveRole would be null — but OFF has
        // no real actor role to evaluate the pure guard against. The UI is hidden in OFF; treat a
        // mutate call as a harmless no-op rather than crash on a null actor role.
        if (authMode === 'off') return reply.code(200).send({ userId, role: nextRole })
        const actorRole = resolveRole(db, req.user!, accountId)! // non-null: authorize proved membership
        if (!canManageMemberRole(actorRole, targetRole, nextRole)) {
          return reply.code(403).send({ error: 'Forbidden.' })
        }
        // LAST-OWNER backstop (needs DB I/O, so not in the pure guard): never demote the sole owner.
        if (targetRole === 'owner' && nextRole !== 'owner' && countOwners(db, accountId) <= 1) {
          return reply.code(403).send({ error: 'An account must keep at least one owner.' })
        }
        upsertMember(db, {
          accountId,
          userId,
          role: nextRole,
          status: 'active',
          createdAt: new Date().toISOString(),
        })
        return reply.code(200).send({ userId, role: nextRole })
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    // REVOKE a member. 404 non-member; 403 by the pure guard (admin can't remove an owner); 403
    // LAST-OWNER (removing the sole owner). 204 on success.
    app.delete('/api/accounts/:accountId/members/:userId', (req, reply) => {
      const { accountId, userId } = req.params as { accountId: string; userId: string }
      if (!authorize(req, reply, accountId, 'manageMembers')) return
      try {
        const targetRole = getMemberRole(db, accountId, userId)
        if (targetRole === null) return reply.code(404).send({ error: 'Not a member of this account.' })
        if (authMode === 'off') {
          // OFF: no real actor role; the UI is hidden — a revoke is an inert no-op (don't crash).
          return reply.code(204).send()
        }
        const actorRole = resolveRole(db, req.user!, accountId)! // non-null: authorize proved membership
        if (!canRemoveMember(actorRole, targetRole)) {
          return reply.code(403).send({ error: 'Forbidden.' })
        }
        if (targetRole === 'owner' && countOwners(db, accountId) <= 1) {
          return reply.code(403).send({ error: 'An account must keep at least one owner.' })
        }
        removeMember(db, accountId, userId)
        return reply.code(204).send()
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    // TRANSFER ownership (P1.11): hand the account to another EXISTING member and step the caller down
    // to admin, atomically. Gated 'transferOwnership' — the ONE action above admin in the matrix, so a
    // mere admin is 403 (authorize resolves the caller's role for this account). Body { toUserId }. The
    // target must already be an active member (404 else) and not the caller (400 — you're already owner).
    // Promote-target and demote-caller commit in ONE tx, so the account always retains an owner (the new
    // one) and is never mid-flight ownerless — hence no separate last-owner backstop is needed. OFF mode
    // (trusted-local) has no real owner model, so it is an inert no-op success (the UI is hidden in OFF).
    app.post('/api/accounts/:accountId/transfer-ownership', (req, reply) => {
      const { accountId } = req.params as { accountId: string }
      const body = (req.body ?? {}) as { toUserId?: unknown }
      if (typeof body.toUserId !== 'string' || body.toUserId.length === 0) {
        return reply.code(400).send({ error: 'toUserId must be a non-empty string.' })
      }
      const toUserId = body.toUserId
      if (!authorize(req, reply, accountId, 'transferOwnership')) return
      if (toUserId === req.user!.id) {
        return reply.code(400).send({ error: 'You are already the owner of this account.' })
      }
      try {
        if (authMode === 'off') {
          // OFF: no real member model (req.user is DEMO_USER) — inert no-op, matching the member routes.
          return reply.code(200).send({ toUserId, role: 'owner' })
        }
        const targetRole = getMemberRole(db, accountId, toUserId)
        if (targetRole === null) return reply.code(404).send({ error: 'Not a member of this account.' })
        const now = new Date().toISOString()
        // Atomic hand-over: promote the target and demote the caller together, so the account is never
        // left without an owner and never transiently shows the caller as a non-owner mid-transfer.
        tx(db, () => {
          upsertMember(db, { accountId, userId: toUserId, role: 'owner', status: 'active', createdAt: now })
          upsertMember(db, { accountId, userId: req.user!.id, role: 'admin', status: 'active', createdAt: now })
        })
        return reply.code(200).send({ toUserId, role: 'owner' })
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    // LIST outstanding invites — NO token in the response (it's a write-once bearer secret; see
    // listInvitesForAccount). Gated 'manageInvites'. OFF → empty.
    app.get('/api/accounts/:accountId/invites', (req, reply) => {
      const { accountId } = req.params as { accountId: string }
      if (!authorize(req, reply, accountId, 'manageInvites')) return
      if (authMode === 'off') return { invites: [] }
      return { invites: listInvitesForAccount(db, accountId) }
    })

    // REVOKE an invite by its non-secret id. Idempotent + scoped by accountId (cross-tenant guard);
    // 204 regardless of whether a row existed (don't leak existence). Gated 'manageInvites'.
    app.delete('/api/accounts/:accountId/invites/:id', (req, reply) => {
      const { accountId, id } = req.params as { accountId: string; id: string }
      if (!authorize(req, reply, accountId, 'manageInvites')) return
      try {
        revokeInvite(db, accountId, id) // idempotent; accountId predicate is the cross-tenant guard
        return reply.code(204).send()
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    // ── P2.5a entity-lifecycle action routes ───────────────────────────────────────────────────────
    // Four dedicated, named action routes wire the PURE lifecycle state machine (shared/domain/
    // lifecycle.ts) into the server for the three tombstone-carrying entities (resources/clients/
    // projects). Each follows the SAME read→transition→persist shape: read the account slice (with
    // tombstones VISIBLE), find the OWNED target, run the pure transition (which THROWS a 409-mapped
    // Error on an illegal source state), write the WHOLE slice back, and audit. They live HERE — after
    // the member/invite routes, before the generic `/api/:entity` routes — so they inherit the child
    // plugin's CORS / rate-limit / error-handler, and Fastify's specificity routing keeps
    // `/api/:entity/:id/archive` from ever colliding with `/api/:entity` or `/api/:entity/:id`.
    //
    // Tiers (mirrors the scoped-write contract): archive/unarchive/delete gate 'write' (editor+);
    // purge — the irreversible HARD cascade — gates 'purge' (admin+). The body's `{ accountId }` is the
    // tenant assertion (required), exactly as the scoped DELETE route asserts ?accountId=. OFF mode is
    // allow-all on all four (authorize's first-line no-op), so the default deploy keeps full access.

    /**
     * Shared front matter for all four lifecycle handlers: validate the entity is lifecycle-capable
     * (else 404), pull + validate the required body `accountId` (else 400), and run the authorize gate
     * for `action` (sends 403 itself on denial). Returns the validated `accountId` on success, or
     * `null` when a response has ALREADY been sent (the caller just `return`s). Keeps the four handlers
     * from duplicating the identical guard preamble.
     */
    const lifecyclePreamble = (
      req: FastifyRequest,
      reply: FastifyReply,
      entity: string,
      action: Action,
    ): string | null => {
      if (!isLifecycleEntity(entity)) {
        reply.code(404).send({ error: `Unknown entity: ${entity}` })
        return null
      }
      const body = (req.body ?? {}) as { accountId?: unknown }
      if (typeof body.accountId !== 'string' || body.accountId.length === 0) {
        reply.code(400).send({ error: 'accountId is required.' })
        return null
      }
      if (!authorize(req, reply, body.accountId, action)) return null // 403 sent inside authorize
      return body.accountId
    }

    /**
     * The built-in Internal client is PROTECTED — it cannot be archived/deleted/purged (the live
     * "exactly one Internal per account" invariant the web store guards). When `row` is the built-in
     * Internal, send a 409 (using `verb` in the message) and return true so the caller bails; else
     * false. `isBuiltinClient` reads the id-independent `builtin` flag (survives import-remap).
     */
    const rejectBuiltinClient = (
      reply: FastifyReply,
      entity: LifecycleEntity,
      row: Resource | Client | Project,
      verb: string,
    ): boolean => {
      // Only a Client carries `builtin`; a Resource/Project never has it, so the entity check gates the
      // read (the `row as Client` is sound under `entity === 'clients'`). isBuiltinClient reads the flag
      // id-independently (survives import-remap).
      if (entity === 'clients' && isBuiltinClient(row as Client)) {
        reply.code(409).send({ error: `The built-in Internal client cannot be ${verb}.` })
        return true
      }
      return false
    }

    // POST /api/:entity/:id/archive — active → archived (editor+). Sets archivedAt to the server clock.
    app.post('/api/:entity/:id/archive', (req, reply) => {
      const { entity, id } = req.params as { entity: string; id: string }
      const accountId = lifecyclePreamble(req, reply, entity, 'write')
      if (accountId === null) return
      try {
        // includeInactive:true so we can SEE an already-archived/deleted row (and 409 on it, rather than
        // 404). includeTimeOffNote:TRUE is LOAD-BEARING — we write the WHOLE slice back via
        // replaceAccountSlice, so a note stripped from the read would be ERASED on persist.
        const slice = store.readSlice(accountId, { includeTimeOffNote: true, includeInactive: true })
        const row = findOwned(slice, accountId, entity as LifecycleEntity, id) // cross-account → throw; absent → null
        if (!row) return reply.code(404).send({ error: 'Not found' })
        if (rejectBuiltinClient(reply, entity as LifecycleEntity, row, 'archived')) return
        const next = archive(row, new Date().toISOString()) // THROWS if not active → lifecycleFail → 409
        const updated = { ...slice, [entity]: slice[entity as LifecycleEntity].map((e) => (e.id === id ? next : e)) }
        replaceAccountSlice(db, accountId, updated)
        audit(reply, {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId,
          action: 'archive',
          entity,
          id,
          changedFields: ['archivedAt'],
        })
        return reply.code(200).send(next)
      } catch (err) {
        return lifecycleFail(reply, err)
      }
    })

    // POST /api/:entity/:id/unarchive — archived → active (editor+). Clears archivedAt.
    app.post('/api/:entity/:id/unarchive', (req, reply) => {
      const { entity, id } = req.params as { entity: string; id: string }
      const accountId = lifecyclePreamble(req, reply, entity, 'write')
      if (accountId === null) return
      try {
        const slice = store.readSlice(accountId, { includeTimeOffNote: true, includeInactive: true })
        const row = findOwned(slice, accountId, entity as LifecycleEntity, id)
        if (!row) return reply.code(404).send({ error: 'Not found' })
        if (rejectBuiltinClient(reply, entity as LifecycleEntity, row, 'unarchived')) return
        const next = unarchive(row) // THROWS if not archived → lifecycleFail → 409
        const updated = { ...slice, [entity]: slice[entity as LifecycleEntity].map((e) => (e.id === id ? next : e)) }
        replaceAccountSlice(db, accountId, updated)
        audit(reply, {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId,
          action: 'unarchive',
          entity,
          id,
          changedFields: ['archivedAt'],
        })
        return reply.code(200).send(next)
      } catch (err) {
        return lifecycleFail(reply, err)
      }
    })

    // POST /api/:entity/:id/delete — archived → soft-deleted (editor+). Sets deletedAt, and for a
    // RESOURCE composes obfuscateResource to scrub the only PII (name) on the retained tombstone (P2.3).
    app.post('/api/:entity/:id/delete', (req, reply) => {
      const { entity, id } = req.params as { entity: string; id: string }
      const accountId = lifecyclePreamble(req, reply, entity, 'write')
      if (accountId === null) return
      try {
        const slice = store.readSlice(accountId, { includeTimeOffNote: true, includeInactive: true })
        const row = findOwned(slice, accountId, entity as LifecycleEntity, id)
        if (!row) return reply.code(404).send({ error: 'Not found' })
        if (rejectBuiltinClient(reply, entity as LifecycleEntity, row, 'deleted')) return
        const deleted = softDelete(row, new Date().toISOString()) // THROWS unless archived → 409
        // Resource is the only entity carrying PII (name); scrub it on the tombstone. obfuscateResource
        // PRESERVES deletedAt/archivedAt and overrides ONLY name, so the changedFields below is exact.
        const next = entity === 'resources' ? obfuscateResource(deleted as Resource) : deleted
        const updated = { ...slice, [entity]: slice[entity as LifecycleEntity].map((e) => (e.id === id ? next : e)) }
        replaceAccountSlice(db, accountId, updated)
        audit(reply, {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId,
          action: 'softDelete',
          entity,
          id,
          // Field NAMES only (the #1 no-PII invariant): 'name' is the NAME of the obfuscated field,
          // never its value. A non-resource delete touches only deletedAt.
          changedFields: entity === 'resources' ? ['deletedAt', 'name'] : ['deletedAt'],
        })
        return reply.code(200).send(next)
      } catch (err) {
        return lifecycleFail(reply, err)
      }
    })

    // POST /api/:entity/:id/purge — HARD-delete a ≥30-day-old soft-deleted tombstone + cascade (admin+).
    // Irreversible: physically removes the row and its dependent children (the same cascade the client's
    // delete uses), so it is gated 'purge' and interlocked behind canPurge (a destructive, fail-closed gate).
    app.post('/api/:entity/:id/purge', (req, reply) => {
      const { entity, id } = req.params as { entity: string; id: string }
      const accountId = lifecyclePreamble(req, reply, entity, 'purge')
      if (accountId === null) return
      try {
        const slice = store.readSlice(accountId, { includeTimeOffNote: true, includeInactive: true })
        const row = findOwned(slice, accountId, entity as LifecycleEntity, id)
        if (!row) return reply.code(404).send({ error: 'Not found' })
        if (rejectBuiltinClient(reply, entity as LifecycleEntity, row, 'purged')) return
        // INTERLOCK (server-enforced): only a soft-deleted tombstone aged ≥ PURGE_MIN_AGE_DAYS may be
        // purged. canPurge is fail-closed (refuses an active/archived row, or any parse failure). This
        // is a state precondition, NOT a transition throw — so it 409s directly, not via lifecycleFail.
        if (!canPurge(row, new Date().toISOString())) {
          return reply.code(409).send({ error: 'Cannot purge: must be a soft-deleted tombstone at least 30 days old.' })
        }
        const cascade =
          entity === 'resources' ? deleteResourceCascade : entity === 'projects' ? deleteProjectCascade : deleteClientCascade
        const purged = cascade(slice, id)
        replaceAccountSlice(db, accountId, purged)
        audit(reply, {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId,
          action: 'purge',
          entity,
          id,
          changedFields: [], // a hard row-delete carries no field set
        })
        return reply.code(204).send()
      } catch (err) {
        return lifecycleFail(reply, err)
      }
    })

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
      // A missing/non-object body (no Content-Type, or a literal JSON `null`) would otherwise
      // null-deref below — body.accountId! for a scoped table, or sanitizeWrite's assertIdPresent
      // for accounts — BEFORE the try block can turn it into a classified response, surfacing as a
      // misclassified 500. Reject it here with the same shape/status /api/batch and /api/import use
      // for a bad body.
      if (!req.body || typeof req.body !== 'object') {
        return reply.code(400).send({ error: 'A request body is required.' })
      }
      // P1.5 write gate (scoped tables only). entity === 'accounts' CREATE is DELIBERATELY NOT
      // membership-gated: a freshly-signed-up auth-on user holds no membership yet and must be able
      // to create their first account (onboarding); there is no `createAccount` Action to require.
      // This open create does NOT extend to DELETE — account hard-delete CASCADES (total tenant
      // destruction) and IS gated 'purge' (admin+) on BOTH vectors: the direct DELETE
      // /api/accounts/:id route AND the batch accounts-DELETE op (see both below). The full
      // archive→soft-delete→purge account lifecycle is P2.5/P2.6; this delete gate is the interim
      // guard. (Batch PUT on accounts = create/update stays open for the same onboarding reason as
      // this POST.) The onboarding exemption is now BOUNDED by the single-company cap just below:
      // it is unconditional only for the first-run (zero-account) case; once any account exists it
      // requires opts.multiAccount, same as every other create vector.
      if (entity === 'accounts' && accountCreateCapped(db, opts)) {
        return reply.code(403).send({ error: SINGLE_COMPANY_CAP_MESSAGE })
      }
      if (isScopedTable(entity)) {
        const body = req.body as { accountId?: string }
        if (!authorize(req, reply, body.accountId!, 'write')) return
      }
      try {
        const row = sanitizeWrite(entity, req.body as Record<string, unknown>)
        validateWrite(loadState(db), entity, row)
        insertRow(db, entity, row)
        // P1.15 audit (post-commit). changedFields = the row's field NAMES (never values).
        audit(reply, {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId: (row.accountId as string | undefined) ?? row.id as string,
          action: 'create',
          entity,
          id: row.id as string,
          changedFields: fieldNames(row),
        })
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
      // P1.5 write gate (scoped tables): membership + write tier for the body's accountId. The
      // ownsRow immutability guard below still runs — authorize gates WHO may write, ownsRow keeps
      // accountId immutable.
      if (isScopedTable(entity) && !authorize(req, reply, body.accountId as string, 'write')) return
      try {
        const existing = getRow(db, entity, id)
        // Single-company cap (create-time only, see accountCreateCapped): a CREATE here is `entity
        // === 'accounts' && !existing` — no row at this id yet. Checked BEFORE the account-write
        // gate below (which only ever fires for the UPDATE case, `existing` truthy) so the two never
        // overlap. An UPDATE of an existing account is NEVER capped, regardless of multiAccount.
        if (entity === 'accounts' && !existing && accountCreateCapped(db, opts)) {
          return reply.code(403).send({ error: SINGLE_COMPANY_CAP_MESSAGE })
        }
        // P1.5 account-write gate. `accounts` is NOT a scoped table (no accountId column), so the
        // isScopedTable() gate above never runs for it — leaving a bare account UPDATE (rename / colour /
        // schedulingMode / disciplines·placeholders·external toggles) ungated, i.e. cross-tenant writable
        // by any signed-in user. An UPDATE (existing row) now requires membership + write tier for the
        // account's OWN id, mirroring the DELETE route's accounts branch; a CREATE (no existing row) stays
        // OPEN per the onboarding exemption (now bounded by the single-company cap just above). OFF
        // mode: authorize no-ops to allow. (See decisions-log.)
        if (entity === 'accounts' && existing && !authorize(req, reply, id, 'write')) return
        // accountId is immutable: a write must not move an EXISTING row to another account
        // (see ownsRow). The web store enforces this via findOwned; without the same guard a
        // crafted request could re-home a row and orphan its children across the tenant boundary.
        if (!ownsRow(existing, body.accountId)) {
          return reply.code(409).send({ error: 'That record belongs to a different company.' })
        }
        // language/weekStartsOn/timezone are FROZEN after creation (P1.14). Compare the PUT body
        // (NOT a merged row) against the stored row: a changed frozen field is a 409; an unchanged
        // one passes (the sync adapter re-sends the whole row on any edit). accounts-only.
        if (entity === 'accounts' && accountFieldsFrozen(existing, body)) {
          return reply.code(409).send({
            error: 'Language, week start and time zone are set when the company is created and cannot be changed.',
          })
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
        const row = sanitizeWrite(entity, body, existing)
        validateWrite(loadState(db), entity, row)
        upsertRow(db, entity, row)
        // P1.15 audit (post-commit). changedFields = the PUT body's field NAMES (never values).
        audit(reply, {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId: (body.accountId as string | undefined) ?? id,
          action: 'update',
          entity,
          id,
          changedFields: fieldNames(body),
        })
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
      // Same guard as the generic POST — a missing/non-object body would otherwise null-deref
      // inside accountFieldsFrozen's `field in incoming` check (entity === 'accounts'), which
      // statusFor can't tell apart from an unexpected bug, so it would surface as a 500.
      if (!req.body || typeof req.body !== 'object') {
        return reply.code(400).send({ error: 'A request body is required.' })
      }
      try {
        const existing = getRow(db, entity, id)
        if (!existing) return reply.code(404).send({ error: 'Not found' })
        // P1.5 account-write gate (see the PUT route): `accounts` isn't scoped, so the merged-accountId
        // authorize below never runs for it. A PATCH always targets an EXISTING row (404 above), so this
        // is always an UPDATE → require membership + write tier for the account's own id. OFF: no-op allow.
        if (entity === 'accounts' && !authorize(req, reply, id, 'write')) return
        const merged = sanitizeWrite(entity, { ...existing, ...(req.body as Record<string, unknown>), id }, existing)
        // P1.5 write gate (scoped tables): membership + write tier for the MERGED row's accountId
        // (the merge inherits the stored accountId unless the body overrides it — and an override is
        // then refused by the ownsRow immutability guard just below). After the 404 so a missing row
        // is a 404, not a 403.
        if (isScopedTable(entity) && !authorize(req, reply, merged.accountId as string, 'write')) return
        // accountId is immutable — a patch must not re-home the row to another company (ownsRow).
        if (!ownsRow(existing, merged.accountId)) {
          return reply.code(409).send({ error: 'That record belongs to a different company.' })
        }
        // language/weekStartsOn/timezone are FROZEN after creation (P1.14). Compare the INCOMING
        // req.body against the stored row — NOT `merged`, which already overwrote `existing` with
        // the patch and would therefore never detect a change. accounts-only.
        if (entity === 'accounts' && accountFieldsFrozen(existing, req.body as Record<string, unknown>)) {
          return reply.code(409).send({
            error: 'Language, week start and time zone are set when the company is created and cannot be changed.',
          })
        }
        validateWrite(loadState(db), entity, merged)
        upsertRow(db, entity, merged)
        // P1.15 audit (post-commit). changedFields = the PATCH req.body keys (the fields the caller
        // actually sent), NOT the merged row's keys — a patch's intent is the keys it touched.
        audit(reply, {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId: (merged.accountId as string | undefined) ?? id,
          action: 'patch',
          entity,
          id,
          changedFields: fieldNames(req.body),
        })
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
          // P1.5 write gate: membership + write tier for the owning account. After the 400/404
          // ownership checks (a missing/cross-account row stays a 404; a real owned row that the
          // caller lacks write access to is the 403).
          if (!authorize(req, reply, accountId, 'write')) return
        } else if (entity === 'accounts') {
          // P1.5 account hard-delete gate. The account-lifecycle CREATE exemption (a new auth-on user
          // must mint their first account before any membership exists) does NOT extend to DELETE:
          // dropping an `accounts` row CASCADES (FK ON DELETE CASCADE) and wipes ALL the account's
          // scoped data — total tenant destruction. So a direct accounts-DELETE is gated 'purge'
          // (admin+, per the Decisions "purge = hard-delete, admin-only") against the caller's role
          // for THAT account — the account's own id IS the accountId to resolve the role against.
          // INTERIM gate pending P2's account-lifecycle rework (archive→soft-delete→purge); OFF mode
          // short-circuits to allow so the default deploy can still delete companies.
          if (!authorize(req, reply, id, 'purge')) return
        }
        // P2.6b: an account hard-delete is a TENANT ERASURE, not a bare row delete. eraseAccount drops
        // the account (FK-cascading its scoped AppData) AND sweeps the control tables + Better Auth PII
        // for any sole-member, all in one transaction. A scoped delete stays the plain idempotent
        // deleteRow (its accountId-scoped cascade is sufficient; no PII to erase).
        if (entity === 'accounts') eraseAccount(db, id)
        else deleteRow(db, entity, id) // idempotent
        // P1.15 audit (post-commit). A delete carries no field set → changedFields = []. accountId
        // is the asserted owner for a scoped table, else the (accounts) row's own id.
        audit(reply, {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId: accountId ?? id,
          action: 'delete',
          entity,
          id,
          changedFields: [],
        })
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
      // P1.5 write gate — PRE-SCAN before the tx opens so the batch is rejected WHOLE (one 403, no
      // partial write) if ANY op targets an account the caller may not write. A scoped PUT derives
      // its accountId from op.row.accountId, a scoped DELETE from op.accountId. The unscoped
      // `accounts` table is the SECOND attack vector for tenant destruction: a batch DELETE on
      // `accounts` is the client's real delete-company path, and it CASCADES (wipes all the account's
      // scoped data), so it is gated 'purge' (admin+) against the account's own id BEFORE the
      // non-scoped skip — the same gate as the direct DELETE /api/accounts/:id route. An accounts
      // PUT (create/update) stays OPEN (onboarding: a membership-less new user mints their first
      // account) and falls through to the skip, UNLESS it's a CREATE the single-company cap denies
      // (accountCreateCapped) — that also fails the whole batch, see below. In OFF mode authorize
      // short-circuits true, so the whole loop is a no-op pass for authz (the default deploy can
      // still delete companies via batch); the cap check is NOT part of that no-op — it runs
      // regardless of authMode.
      for (const op of ops) {
        if (op?.table === 'accounts' && op.method === 'DELETE') {
          if (!authorize(req, reply, op.id, 'purge')) return
          continue
        }
        if (op?.table === 'accounts' && op.method === 'PUT') {
          // Only look up a STRING id — a missing/non-string id would throw on the SQLite bind here,
          // and is anyway left to the apply loop's own null-id validation (→ 400).
          const existingAccount = typeof op.id === 'string' ? getRow(db, 'accounts', op.id) : undefined
          if (existingAccount) {
            // A batch PUT on an EXISTING account is an UPDATE → gate 'write' (the same cross-tenant
            // account-write guard the per-route PUT/PATCH now apply). NEVER capped — enforcement is
            // create-time only.
            if (!authorize(req, reply, op.id, 'write')) return
          } else if (accountCreateCapped(db, opts)) {
            // A CREATE (no existing row) stays OPEN per the onboarding exemption ONLY while the
            // single-company cap allows it (see accountCreateCapped). When it doesn't, fail the WHOLE
            // batch — same one-403-no-partial-write semantics as every other pre-scan denial above.
            reply.code(403).send({ error: SINGLE_COMPANY_CAP_MESSAGE })
            return
          }
          continue
        }
        if (typeof op?.table !== 'string' || !isKnownTable(op.table) || !isScopedTable(op.table)) continue
        const accountId = op.method === 'PUT' ? (op.row as { accountId?: string } | undefined)?.accountId : op.accountId
        if (!authorize(req, reply, accountId as string, 'write')) return
      }
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
              // language/weekStartsOn/timezone are FROZEN after creation (P1.14). DOCUMENTED
              // ASYMMETRY: the per-route PUT/PATCH return 409 (what the acceptance asserts), but a
              // ValidationError in the batch maps to 400 — the batch is the INTERNAL sync path, and
              // the disabled Settings UI never sends a changed frozen field, so a violation here is
              // a malformed client, not a user action. accounts-only.
              if (table === 'accounts' && accountFieldsFrozen(existing, row as Record<string, unknown>)) {
                throw new ValidationError(
                  'Language, week start and time zone are set when the company is created and cannot be changed.',
                )
              }
              const clean = sanitizeWrite(table, row as Record<string, unknown>, existing)
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
              // P2.6b: an account DELETE in the batch is a TENANT ERASURE (control tables + Better Auth
              // PII), same as the direct route. We are ALREADY inside tx() here, so call eraseAccountInTx
              // (NOT eraseAccount — node:sqlite has no nested BEGIN). Scoped deletes stay plain deleteRow.
              if (table === 'accounts') eraseAccountInTx(db, id)
              else deleteRow(db, table, id)
            } else {
              throw new ValidationError(`Unknown op method: ${String(method)}`)
            }
          }
        })
        // P1.15 audit (POST-COMMIT — outside the tx). The whole batch is all-or-nothing, so we
        // only get here once it committed; a rolled-back batch threw above and logs NOTHING. One
        // line PER op (action mirrors the op verb); the per-op append results OR-reduce into ONE
        // warning so a single failed write still flags x-capacitylens-audit-warning. changedFields
        // for a PUT = op.row's field NAMES (never values); a DELETE carries none.
        const ts = new Date().toISOString()
        let auditFailed = false
        for (const op of ops) {
          const record: AuditRecord =
            op.method === 'PUT'
              ? {
                  ts,
                  userId: req.user!.id,
                  accountId: (op.row as { accountId?: string } | undefined)?.accountId ?? op.id,
                  action: 'update',
                  entity: op.table,
                  id: op.id,
                  changedFields: fieldNames(op.row),
                }
              : {
                  ts,
                  userId: req.user!.id,
                  accountId: op.accountId ?? op.id,
                  action: 'delete',
                  entity: op.table,
                  id: op.id,
                  changedFields: [],
                }
          if (!auditSink.append(record)) auditFailed = true
        }
        if (auditFailed) reply.header('x-capacitylens-audit-warning', 'true')
        return reply.code(200).send({ ok: true, applied: ops.length, auditWarning: auditFailed })
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    // Bulk import into one account, reusing the SAME remap+validate+sanitize the store
    // runs (shared/domain/mutations.remapAndValidateImport). Body: { accountId, data }.
    // `data` may be a raw export ({schemaVersion,data} or bare AppData); parseData
    // applies the shape guard + MAX_IMPORT_RECORDS cap + migration.
    //
    // EXEMPT from the single-company cap: replaceAccountSlice only ever rewrites SCOPED tables
    // (accountId-carrying), never `accounts` itself — an import can only replace an EXISTING
    // account's data, never insert a new top-level accounts row. So there is no create vector here
    // for accountCreateCapped to gate.
    app.post('/api/import', (req, reply) => {
      const body = req.body as { accountId?: string; data?: unknown }
      if (!body || typeof body.accountId !== 'string') {
        return reply.code(400).send({ error: 'accountId is required' })
      }
      // P1.5 write gate: import replaces an entire account slice (replaceAccountSlice), so it is a
      // privileged write — require membership + write tier for the target account before parsing.
      if (!authorize(req, reply, body.accountId, 'write')) return
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
        // P1.15 audit (post-commit). ONE 'import' line: a slice replace, not a per-field edit, so
        // changedFields = [] (no individual fields to name) and id = the target accountId.
        const auditOk = auditSink.append({
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId: body.accountId,
          action: 'import',
          entity: 'account',
          id: body.accountId,
          changedFields: [],
        })
        if (!auditOk) reply.header('x-capacitylens-audit-warning', 'true')
        return { imported: result.imported, skipped: result.skipped, maxRecords: MAX_IMPORT_RECORDS, auditWarning: !auditOk }
      } catch (err) {
        return sendFail(reply, err)
      }
    })

    // Test-only: wipe (and optionally re-seed) so E2E/integration runs start clean.
    //
    // EXEMPT from the single-company cap: this is the raw insertAll test-only path (itself
    // production-forbidden — see bootGuard/resetForbidden, and opts.allowReset just below), not an
    // HTTP create vector the cap is meant to police. It's how e2e fixtures reach a known
    // multi-company state (the demo seed ships TWO companies) without threading multiAccount
    // through every spec.
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
