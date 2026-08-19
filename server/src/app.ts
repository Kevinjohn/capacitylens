import { createHash } from "node:crypto";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import Fastify from "fastify";
import rateLimitPlugin from "@fastify/rate-limit";
import helmetPlugin from "@fastify/helmet";
import { MAX_RATE_LIMIT, normalizeRateLimit, parseRateLimit } from "./rateLimit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  DEMO_USER,
  DEFAULT_ACCOUNT_APPLICATION,
  countUsers,
  secretTokenMatches,
  type Auth,
  type AuthMode,
  type SessionUser,
} from "./auth";
import {
  type ActorContext,
  type ApplicationSession,
  type BoundApplication,
  type CommandIdentity,
} from "@capacitylens/shared/account/types";
import { ACCOUNT_SESSION_FRESH_AGE_SECONDS } from "@capacitylens/shared/account/sessionPolicy";
import { AccountContractError, statusForAccountFailure } from "@capacitylens/shared/account/errors";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import {
  boundApplicationFailure,
  isAccountCommandId,
  isAccountIdempotencyKey,
  isBrowserSyncSessionId,
} from "@capacitylens/shared/account/validation";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import { betterAuthIdentityPort, type SsoCutoverIdentityPort } from "./accounts/betterAuthIdentityPort";
import { sqliteAccountAdminPort } from "./accounts/sqliteAccountAdminPort";
import { registerSsoCutoverRoutes } from "./accounts/ssoCutoverRoutes";
import { actorContextFromSession, localAccountFlows } from "./accounts/localAccountFlows";
import { KeyedOperationLock } from "./accounts/operationLock";
import { trustedLocalIdentityPort } from "./accounts/trustedLocalIdentityPort";
import { registerAccountRoutes } from "./accounts/accountRoutes";
import { memberSignInTrackingSnapshot, setMemberSignInTracking } from "./accounts/memberSignInTracking";
import { registerLifecycleRoutes } from "./routes/lifecycleRoutes";
// Every `accounts`-row write rule lives in ONE module (see its header). The generic /api/:entity
// routes below refuse `accounts` outright; the batch loop shares these predicates so the sync path
// and the dedicated routes cannot drift.
import {
  ACCOUNT_CREATE_CLOSED_MESSAGE,
  ACCOUNT_FROZEN_FIELDS_MESSAGE,
  SINGLE_COMPANY_CAP_MESSAGE,
  accountCreateCapped,
  accountFieldsFrozen,
  canonicalAccountProductPayload,
  countAccounts,
  registerAccountEntityRoutes,
} from "./routes/accountEntityRoutes";
import { eraseWorkspaceProductDataInTx } from "./erasure";
import { internalTlsHealth } from "./internalTls";
import { currentRequestAbortSignal, runWithRequestAbortSignal } from "./requestAbort";

// The identity requireUser attaches to every gated request. Session/identity
// plumbing ONLY — accountId stays client-asserted (ownsRow is still the tenant guard);
// this is the seam Stage C will later use to derive accountId server-side.
declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
    accountActor: ActorContext | null;
    authenticationUserId: string | null;
    authenticationProviderId: string | null;
  }
}
import { parseData, MAX_IMPORT_RECORDS } from "@capacitylens/shared/data/transfer";
import {
  APP_DATA_KEYS,
  emptyAppData,
  isScopedEntityKey,
  type AppData,
  type AppDataKey,
} from "@capacitylens/shared/types/entities";
// Shared lifecycle allow-list also protects the generic entity routes; the dedicated transition
// pipeline is registered through routes/lifecycleRoutes below.
import { archive, isLifecycleEntityKey } from "@capacitylens/shared/domain/lifecycle";
import { allocationAttributionAllowed } from "@capacitylens/shared/lib/integrity";
import { seed } from "@capacitylens/shared/data/seed";
import { TABLES } from "./tables";
import {
  acceptedFieldNames,
  appliedRequestedFieldNames,
  validateWrite,
  sanitizeWrite,
  ValidationError,
} from "./validate";
import {
  readSliceVisibility,
  redactGatedEcho,
  tableHasGatedFields,
  visibilityForRole,
  type SanitizeWriteOptions,
} from "./fieldPolicy";
import {
  builtinInternalWriteGuard,
  checkEntityWriteBody,
  FULL_SLICE_READ,
  generatedBuiltinReplacement,
  prepareScopedWrite,
  replaceGeneratedBuiltin,
  stampServerRevision,
} from "./writePipeline";
import {
  type Db,
  clearAllocationAttributionForActivities,
  type RewrittenAllocationRevision,
  deleteRow,
  getRow,
  insertAll,
  insertRow,
  isInitialized,
  listAccountSummaries,
  loadState,
  replaceAccountSlice,
  validatedCompleteAccountSlice,
  upsertRow,
  wipe,
} from "./db";
import { sqliteTenantStore, type LifecycleRow } from "./tenantStore";
// P2.6b tenant erasure is composed below through AccountFlows: product data, account administration
// and local identity state retain separate owners while the local coordinator preserves one SQLite
// transaction for the dedicated deletion endpoint.
import { can, canSeePrivateNames, type Action } from "@capacitylens/shared/domain/access";
import { tx } from "./txn";
import { newId } from "@capacitylens/shared/lib/id";
import { buildInternalClient, isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import { type AuditRecord, type AuditSink, noopAuditSink } from "./audit";
import { enqueueAudit } from "./auditOutbox";
import { createAuditOutboxDrainer } from "./auditOutboxDrainer";
import { isSameSessionSuccessor, isSupersededSyncBatch, recordAppliedSyncBatch, type SyncOrder } from "./syncOrdering";
import { BatchStateProjection } from "./batchProjection";
import { runImportWorker } from "./runImportWorker";
import { WorkQueueFullError } from "./workQueue";
import { nextServerRevision } from "./revision";

// ~5 MB request cap. A normal account is far smaller; an over-cap body is rejected
// by Fastify with 413 before our handlers run (mirrors the client's import guard).
const BODY_LIMIT = 5 * 1024 * 1024;

function writeActivityRow(
  db: Db,
  projection: BatchStateProjection | undefined,
  row: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  collectedActivityIds?: Set<string>,
): RewrittenAllocationRevision[] {
  upsertRow(db, "activities", row);
  projection?.upsert("activities", row);
  // A newly created activity cannot have an allocation referencing it yet, so POST/PUT-create
  // never needs a sweep. Existing rows are collected exactly when this write lands ineligible.
  if (!existing || allocationAttributionAllowed(row.kind)) return [];
  const id = row.id as string;
  if (projection && collectedActivityIds) {
    collectedActivityIds.add(id);
    projection.clearAllocationAttributionForActivity(id);
    return [];
  }
  return clearAllocationAttributionForActivities(db, new Set([id]));
}

// Cap on ops per POST /api/batch request (the MAX_IMPORT_RECORDS precedent, applied to the sync
// path). BODY_LIMIT bounds request BYTES, but not request WORK: every operation is sanitized,
// authorized, validated and applied to the in-memory projection. The transaction reads each
// affected account slice once, then indexed point/reverse lookups keep per-op validation and
// projection updates proportional to each operation's referenced/affected rows rather than the
// whole tenant. Op COUNT is therefore the remaining request-controlled multiplier. 5 000 is
// generous headroom over the largest realistic full-slice diff the client sync adapter produces
// (a whole busy agency's slice is low-thousands of rows) while bounding a crafted/looping flood.
// The inclusive boundary integration test applies 5 000 real existing-row updates and enforces a
// four-second handler budget under the supported Node 24 gate, leaving headroom below the packaged
// five-second container healthcheck timeout. Keep that budget, this cap and the client's matching
// MAX_OPS_PER_BATCH in lockstep; an in-process queue cannot shorten one synchronous SQLite turn.
// Checked BEFORE the pre-scan and tx, so an over-cap batch writes nothing.
// Exported for the test that pins the boundary.
export const MAX_BATCH_OPS = 5000;

// Fastify defaults BOTH to 0 (disabled). The documented deploy fronts this server with Nginx,
// which buffers/queues the client connection — 30s is generous headroom for that hop, and it's
// the guard that protects the documented DIRECT-EXPOSURE mode (no reverse proxy) from a
// slowloris-style slow-body/slow-read socket exhaustion attack that an unbounded timeout permits.
const REQUEST_TIMEOUT_MS = 30_000;
const CONNECTION_TIMEOUT_MS = 30_000;
export const MAX_SERVER_CONNECTIONS = 512;
const CSP_REPORT_BODY_LIMIT = 64 * 1024;
// One unauthenticated request may produce at most one security-log record even when the Reporting
// API sends an array. This prevents request-to-log amplification when the optional global limiter
// is disabled; browsers retry later reports independently.
const MAX_CSP_REPORTS_PER_REQUEST = 1;

// Only these parsing errors have messages we intentionally preserve for clients. Return canonical
// text rather than trusting even an allow-listed error object's message to remain harmless.
const SAFE_CLIENT_ERRORS = new Map<string, { status: number; message: string }>([
  ["FST_ERR_CTP_BODY_TOO_LARGE", { status: 413, message: "Request body is too large" }],
  ["FST_ERR_CTP_INVALID_MEDIA_TYPE", { status: 415, message: "Unsupported Media Type" }],
  [
    "FST_ERR_CTP_INVALID_CONTENT_LENGTH",
    {
      status: 400,
      message: "Request body size did not match Content-Length",
    },
  ],
  [
    "FST_ERR_CTP_EMPTY_JSON_BODY",
    {
      status: 400,
      message: "Body cannot be empty when content-type is set to 'application/json'",
    },
  ],
  [
    "FST_ERR_CTP_INVALID_JSON_BODY",
    {
      status: 400,
      message: "Body is not valid JSON but content-type is set to 'application/json'",
    },
  ],
  ["CAPACITYLENS_MALFORMED_CSP_REPORT", { status: 400, message: "Malformed CSP report" }],
  ["CAPACITYLENS_RATE_LIMITED", { status: 429, message: "Rate limit exceeded" }],
]);

function safeClientError(error: unknown): { status: number; message: string } | null {
  if (!(error instanceof Error)) return null;
  const candidate = error as Error & { code?: unknown; statusCode?: unknown };
  if (typeof candidate.code !== "string") return null;
  const safe = SAFE_CLIENT_ERRORS.get(candidate.code);
  return safe && candidate.statusCode === safe.status ? safe : null;
}

const MIN_BOOTSTRAP_TOKEN_BYTES = 32;

// Fail-CLOSED CORS default: only the local Vite dev/e2e origins may make cross-origin
// browser calls. The factory itself uses this (not a wildcard) so a caller that forgets
// to pass corsOrigin is still locked down; opening the API to every site requires an
// EXPLICIT '*'. The entrypoint (index.ts) imports this same default and lets
// CAPACITYLENS_CORS_ORIGIN override it for a deliberate deploy.
export const DEFAULT_CORS = "http://localhost:5173,http://localhost:5273,http://127.0.0.1:5173,http://127.0.0.1:5273";

export interface AppOptions {
  /** Stable identity and display branding for this product installation's account boundary. */
  application?: BoundApplication;
  /** Optional internal HTTPS identity for a reverse-proxy/service hop. The default Compose
   * topology provisions and verifies it; a trusted same-host loopback proxy may omit it. */
  internalTls?: Pick<HttpsServerOptions, "key" | "cert" | "minVersion">;
  /** Parsed once from the configured internal certificate; deep health projects its remaining
   * validity without rereading tenant data or certificate files on every public probe. */
  internalTlsExpiresAt?: string;
  /** SHA-256 of the exact certificate bytes loaded into the live HTTPS context. */
  internalTlsFingerprintSha256?: string;
  /** Gate POST /api/test/reset — only enabled for auth-off tests / explicit local dev opt-in. */
  allowReset?: boolean;
  /** CAPACITYLENS_LOG=1 — structured per-request logging (Fastify's bundled pino, JSON on
   *  stdout: method/path/status/latency), and the 500-path error log routed through the
   *  request-scoped logger. Default OFF = exactly today's behaviour (startup line +
   *  console.error on 500s). */
  log?: boolean;
  /** Test seam: where the JSON log lines go when `log` is on (default stdout). */
  logStream?: { write(msg: string): void };
  /** Structured security-event destination. The entrypoint emits JSONL to stdout for forwarding;
   * tests/factory consumers default to a no-op. Must never throw into a request. */
  securityLog?: (event: Record<string, unknown>) => void;
  /** CAPACITYLENS_HEALTH_DEEP=1 — /api/health also proves the DB answers a constant-work read:
   *  200 { ok, db: true }, or 503 { ok: false } when the read throws. Default OFF =
   *  today's unconditional { ok: true } (Playwright's webServer probe depends on it). */
  healthDeep?: boolean;
  /** Optional scheduled-backup health provider. Present only when backups are configured; kept as
   * a callback because the entrypoint starts the scheduler after Fastify construction. */
  backupHealth?: () => Readonly<{
    degraded: boolean;
    lastSuccessAt: string | null;
  }>;
  /** CAPACITYLENS_RATE_LIMIT=<n> — n requests/minute per IP across /api/* (a guard against an
   *  accidental client loop hammering the single-writer SQLite file and remote resource
   *  exhaustion). Health is exempt so liveness probes cannot be starved by application traffic.
   *  0 / omitted ⇒ the plugin is not registered at all. Any other value must be an integer in the
   *  shared supported range; invalid programmatic configuration is rejected at construction. */
  rateLimit?: number;
  /** Trust the immediate reverse proxy's sanitized forwarding headers. This keys rate limits on
   *  X-Forwarded-For and reconstructs the browser-visible scheme for the CSRF same-origin check
   *  from X-Forwarded-Proto. Set ONLY when the API is unreachable directly and the proxy overwrites
   *  both headers; on a directly exposed host either header is client-spoofable. */
  trustProxyHeaders?: boolean;
  /** CAPACITYLENS_AUTH: 'off' (the default) means Better Auth does not exist here —
   *  the only auth surface is GET /api/auth/me reporting the demo identity, and
   *  requireUser attaches that identity and continues, so NO request that succeeds
   *  today may fail. 'password'/'sso' mount opts.auth's handler at /api/auth/* and
   *  401 every other /api/* route (except /api/health) without a valid session. */
  authMode?: AuthMode;
  /** The Better Auth instance — required exactly when authMode ≠ 'off'. */
  auth?: Auth | null;
  /** Require an enrolled and completed TOTP second factor before password users may access tenant
   * data. Auth endpoints and /api/auth/me remain available so an existing user can enroll. */
  requireMfa?: boolean;
  /** Resolved registration posture used by the SSO cutover verifier. */
  allowOpenSignup?: boolean;
  /** CORS allow-list: a comma-separated list of explicit origins. Wildcards are rejected because
   *  the browser client always uses cookie credentials. Defaults to the localhost allow-list when
   *  omitted — so the factory is safe even if a caller forgets to pass it. The
   *  entrypoint (index.ts) passes the CAPACITYLENS_CORS_ORIGIN override. */
  corsOrigin?: string;
  /** PUT rejects a write whose row is older than the stored row (updatedAt compare) with 409.
   *  Enabled by default because membership makes every server deployment multi-writer. Pass false
   *  only as an explicit legacy escape hatch. Ordered browser-sync batches still enforce their
   *  revision preconditions so overlapping requests cannot overwrite a newer sequence. */
  optimisticConcurrency?: boolean;
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
  multiAccount?: boolean;
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
  bootstrapToken?: string;
  /** CAPACITYLENS_HTTPS=1 — the API is reached over HTTPS, so HSTS is safe to emit.
   *  Default false: HSTS (Strict-Transport-Security) is ONLY valid over HTTPS and is
   *  actively HARMFUL over plain HTTP — a browser that caches an HSTS directive received
   *  on http:// would force https:// on a host that has no TLS, breaking it. This server
   *  typically runs HTTP behind a TLS-terminating proxy (Nginx), so the operator must
   *  OPT IN once TLS truly fronts the public origin. Off ⇒ helmet emits no HSTS header;
   *  all other helmet baseline headers (nosniff, CSP, Referrer-Policy, X-Frame-Options)
   *  are on regardless, as they are pure improvements with no HTTPS precondition. */
  https?: boolean;
  /** CAPACITYLENS_AUDIT (P1.15) — the append-only JSONL audit sink. ON-by-default is decided at
   *  the index.ts layer (which builds a fileAuditSink from env, or a noop when =off); THIS factory
   *  defaults to noopAuditSink() so tests AND the default local/no-server deploy are byte-identical
   *  unless a real sink is explicitly injected. NEVER pass a row/body into the sink — only typed
   *  product or normalized account entries whose changedFields are field NAMES (the #1 no-PII
   *  invariant). */
  audit?: AuditSink;
  /** Test seam for deterministically pausing import preparation around concurrent writes. The
   * production default always uses the worker-thread implementation. */
  importWorker?: typeof runImportWorker;
}

const IMPORT_SNAPSHOT_STALE_MESSAGE =
  "The company data changed while the import was being prepared. Retry the import from the latest data.";

class ImportSnapshotConflictError extends Error {
  constructor() {
    super(IMPORT_SNAPSHOT_STALE_MESSAGE);
    this.name = "ImportSnapshotConflictError";
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

/** Fingerprint only the scoped rows an import replaces. Row and field ordering are normalized so
 * equivalent SQLite reads compare equal while any accepted tenant mutation changes the token. */
function importSnapshotFingerprint(slice: AppData): string {
  const scoped = Object.fromEntries(
    APP_DATA_KEYS.filter((table) => table !== "accounts").map((table) => [
      table,
      [...slice[table]].sort((left, right) => left.id.localeCompare(right.id)),
    ]),
  );
  return createHash("sha256").update(canonicalJson(scoped)).digest("base64url");
}

// P0.5.5: NEVER let a secret reach the logs. pino strips these exact paths from every record
// when logging is on; remove:true DELETES the key (so the value is gone entirely, not printed as
// "[Redacted]"). DEFENSE-IN-DEPTH: Fastify's default req/res serializers don't log headers at all
// (req → method/url/hostname/remoteAddress; res → statusCode/responseTime), so today nothing here
// would emit these — but the moment a custom serializer logs headers, or someone logs a raw req/res,
// this is the backstop that keeps Authorization / Cookie / Set-Cookie out of stdout. If such a
// serializer is ever added, extend this list to cover any new path it surfaces.
const LOG_REDACT_PATHS = ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'];

// Mask the bearer token in every token-scoped invite URL before it reaches the access log. The token
// is the ONLY path-borne secret in the API; every other URL passes through unchanged. Anchored to
// the exact `/api/invites/<token>/accept` shape (optionally with a query string) so a normal path
// is never mangled. The match is on the path-with-query string pino logs (req.url).
const INVITE_OPERATION_URL_RE = /^(\/api\/invites\/)[^/?#]+(\/(?:accept|signup|preview))(.*)$/;
// `url` is typed unknown because the serializer may also run over a hand-built `{ req: {...} }`
// record (e.g. app.log.info(...)) whose url is absent; a non-string passes through untouched.
const redactSecretUrl = (url: unknown): string | undefined => {
  if (typeof url !== "string") return undefined;
  const inviteSafe = url.replace(INVITE_OPERATION_URL_RE, "$1[redacted]$2$3");
  try {
    const parsed = new URL(inviteSafe, "http://capacitylens.invalid");
    for (const key of ["token", "code", "state"]) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, "[redacted]");
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return inviteSafe;
  }
};

/** Build the exact structured logger policy consumed by Fastify.
 *  Exported so tests can pin redaction before req/res serializers discard header objects. */
export function requestLoggerOptions(stream?: AppOptions["logStream"]) {
  return {
    ...(stream ? { stream } : {}),
    redact: { paths: LOG_REDACT_PATHS, remove: true as const },
    serializers: {
      req(req: FastifyRequest) {
        return {
          method: req.method,
          url: redactSecretUrl(req.url),
          hostname: req.hostname,
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort,
        };
      },
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeCspDirective = (value: unknown): string | undefined =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/i.test(value) ? value : undefined;

// CSP fields can contain full URLs, including query/fragment secrets. Security telemetry needs only
// the origin; special browser values such as "inline" are retained as a bounded classification.
const safeCspOrigin = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  if (["inline", "eval", "self", "data", "blob"].includes(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : `scheme:${url.protocol}`;
  } catch {
    return undefined;
  }
};

function normalizedCspReports(payload: unknown): Record<string, unknown>[] {
  const candidates = Array.isArray(payload) ? payload.slice(0, MAX_CSP_REPORTS_PER_REQUEST) : [payload];
  const reports: Record<string, unknown>[] = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const legacy = isRecord(candidate["csp-report"]) ? candidate["csp-report"] : undefined;
    const modern = candidate.type === "csp-violation" && isRecord(candidate.body) ? candidate.body : undefined;
    const body = legacy ?? modern;
    if (!body) continue;
    reports.push({
      event: "csp_violation",
      outcome: "reported",
      documentOrigin: safeCspOrigin(body["document-uri"] ?? body.documentURL),
      blockedOrigin: safeCspOrigin(body["blocked-uri"] ?? body.blockedURL),
      effectiveDirective: safeCspDirective(body["effective-directive"] ?? body.effectiveDirective),
      violatedDirective: safeCspDirective(body["violated-directive"]),
      disposition: body.disposition === "report" || body.disposition === "enforce" ? body.disposition : undefined,
    });
  }
  return reports;
}

// parseRateLimit / MAX_RATE_LIMIT now live in ./rateLimit so productionGuard.ts can share the ONE
// true parser without importing the whole app (import-cycle-safe). Re-exported here to preserve the
// existing './app' public surface that index.ts and the rate-limit tests already import from.
export { MAX_RATE_LIMIT, parseRateLimit };

/** Node's IncomingHttpHeaders → web Headers, for Better Auth's web-standard API
 *  (getSession reads the cookie; the mounted handler gets the full set). */
function toWebHeaders(raw: FastifyRequest["headers"]): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") headers.append(key, value);
    else if (Array.isArray(value)) for (const item of value) headers.append(key, item);
  }
  return headers;
}

/** Resolve only an already-issued, verified session for security-event attribution. Submitted
 * identifiers are intentionally never used: a failed sign-in must not be able to claim a user. */
async function resolveAuthenticationUserId(
  auth: Auth,
  headers: Headers,
  req: FastifyRequest,
  logOn: boolean,
): Promise<string | null> {
  try {
    return (await auth.api.getSession({ headers }))?.user.id ?? null;
  } catch (error) {
    if (logOn) req.log.error(error, "authentication security-event attribution failed");
    else console.error("capacitylens-server: authentication security-event attribution failed", error);
    return null;
  }
}

/** Turn Set-Cookie response fields into the Cookie header used to verify a newly issued session.
 * Response values replace request values with the same name (for example an MFA challenge cookie
 * replaced by the final session cookie); attributes never cross into the request header. */
function withResponseCookies(requestHeaders: Headers, setCookies: readonly string[]): Headers {
  const cookies = new Map<string, string>();
  for (const pair of (requestHeaders.get("cookie") ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    if (name) cookies.set(name, pair.slice(separator + 1).trim());
  }
  for (const setCookie of setCookies) {
    const pair = setCookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    if (name) cookies.set(name, pair.slice(separator + 1).trim());
  }
  const headers = new Headers(requestHeaders);
  headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
  return headers;
}

function sessionUserFromApplicationSession(session: ApplicationSession): SessionUser {
  return {
    id: session.principal.id,
    email: session.principal.email,
    emailVerified: session.principal.emailVerified,
    name: session.principal.displayName,
    image: session.principal.image ?? null,
    twoFactorEnabled: sessionSatisfiesRequiredMfa(session),
    sessionCreatedAt: session.createdAt,
  };
}

/** CapacityLens treats provider-authenticated and trusted-local sessions as satisfying its local
 * MFA gate; provider-side MFA enforcement remains an explicit operator responsibility. */
function sessionSatisfiesRequiredMfa(session: ApplicationSession): boolean {
  return session.assurance === "mfa" || session.assurance === "federated" || session.assurance === "trusted-local";
}

/** CapacityLens's complete public seam into Better Auth. New dependency routes remain closed until
 * they are deliberately classified here and covered by the application's own policy surface. */
function betterAuthProxyRouteAllowed(authMode: Exclude<AuthMode, "off">, method: string, pathname: string): boolean {
  const common = new Set(["GET /get-session", "POST /sign-out", "POST /sign-in/oauth2", "POST /sign-in/social"]);
  if (common.has(`${method} ${pathname}`)) return true;
  if (
    (method === "GET" || method === "POST") &&
    (/^\/oauth2\/callback\/[a-z0-9_-]+$/.test(pathname) || /^\/callback\/[a-z0-9_-]+$/.test(pathname))
  ) {
    return true;
  }
  if (method === "GET" && /^\/oidc\/authorize\/[a-z0-9_-]+$/.test(pathname)) return true;
  if (authMode !== "password") return false;
  return new Set([
    "POST /sign-up/email",
    "POST /sign-in/email",
    "POST /reset-password",
    "POST /change-password",
    "POST /two-factor/enable",
    "POST /two-factor/disable",
    "POST /two-factor/generate-backup-codes",
    "POST /two-factor/verify-totp",
    "POST /two-factor/verify-backup-code",
  ]).has(`${method} ${pathname}`);
}

function replayAccountCommand(req: FastifyRequest): CommandIdentity | null {
  const idempotencyKey = req.headers["idempotency-key"];
  const commandId = req.headers["x-account-command-id"];
  return isAccountIdempotencyKey(idempotencyKey) && isAccountCommandId(commandId)
    ? { commandId, idempotencyKey }
    : null;
}

function accountCommand(req: FastifyRequest): CommandIdentity {
  const rawIdempotency = req.headers["idempotency-key"];
  const rawCommand = req.headers["x-account-command-id"];
  if (rawIdempotency !== undefined && !isAccountIdempotencyKey(rawIdempotency)) {
    throw new AccountContractError({
      code: "VALIDATION_FAILED",
      message: "Idempotency-Key must be a 16–128 character opaque base64url-style identifier.",
      retryable: false,
    });
  }
  if (rawCommand !== undefined && !isAccountCommandId(rawCommand)) {
    throw new AccountContractError({
      code: "VALIDATION_FAILED",
      message:
        "X-Account-Command-Id must be a 16–128 character independently generated, unguessable base64url-style identifier.",
      retryable: false,
    });
  }
  if ((rawIdempotency === undefined) !== (rawCommand === undefined)) {
    throw new AccountContractError({
      code: "VALIDATION_FAILED",
      message: "Idempotency-Key and X-Account-Command-Id must be supplied together.",
      retryable: false,
    });
  }
  const idempotencyKey = isAccountIdempotencyKey(rawIdempotency) ? rawIdempotency : newId();
  // They serve different purposes and remain independent even for compatibility callers that do
  // not yet send either header: the command id is the reconciliation handle, while the
  // idempotency key identifies one semantic retry ceremony.
  const commandId = isAccountCommandId(rawCommand) ? rawCommand : newId();
  return { commandId, idempotencyKey };
}

/** Stable server-owned id for an omitted workspace id. A retry carrying the same command must
 * address the same workspace rather than minting a new id and conflicting with its own ledger. */
function generatedWorkspaceId(commandId: string): string {
  return `w_${createHash("sha256")
    .update("capacitylens-workspace-command\0")
    .update(commandId)
    .digest("base64url")
    .slice(0, 21)}`;
}

const isKnownTable = (entity: string): entity is keyof typeof TABLES =>
  Object.prototype.hasOwnProperty.call(TABLES, entity);

/**
 * The tables the GENERIC /api/:entity routes serve: every known table except `accounts`, which has
 * its own dedicated static routes (routes/accountEntityRoutes.ts).
 *
 * Fastify matches those static paths first, so this is unreachable in practice — it is a fail-CLOSED
 * backstop. `accounts` carries no accountId column, so every guard the generic handlers derive from
 * `row.accountId` (the isScopedTable authorize gate, ownsRow, the scoped DELETE owner assertion) is
 * a silent no-op for it; if a dedicated verb is ever removed, an account row must 404 loudly here
 * rather than fall through to those no-op scoped semantics. /api/batch keeps its own account
 * handling (a client sync diff genuinely carries accounts ops) and still uses isKnownTable.
 */
const isGenericEntity = (entity: string): entity is keyof typeof TABLES =>
  isKnownTable(entity) && entity !== "accounts";

// Request-validation guard for the invite-create role (P1.9). A bad/missing role is a CALLER fault
// (400), distinct from createInvite's loud throw (a 500-tier integrity backstop for a role that
// somehow slipped past here). Mirrors the closed Role vocabulary in shared/domain/access.
// Scoped membership is shared with the import/write sanitizer. Scoped deletes must assert
// ownership via accountId, so this must not be inferred independently from the SQLite codec.
const isScopedTable = isScopedEntityKey;

// The ONLY three entities that carry the lifecycle tombstones (archivedAt/deletedAt, P2.1) and so can
// run the archive/unarchive/soft-delete/purge routes (P2.5a). A guard, not a free string compare, so a
// lifecycle handler can `entity is LifecycleEntity`-narrow before indexing AppData[entity] — and any
// other table (phases/activities/allocations/timeOff/disciplines/accounts) is a 404 on these routes.
// Single-sourced in shared (LIFECYCLE_ENTITY_KEYS) so this route allow-list and validate.ts's
// sanitizeWrite tombstone-pin can't drift; aliased to the local names the handlers below already use.
const isLifecycleEntity = isLifecycleEntityKey;

// The wire shape of one op in a POST /api/batch body (mirrors the client's syncOps.Op).
interface BatchOp {
  method: "PUT" | "DELETE" | "ARCHIVE";
  table: string;
  id: string;
  row?: Record<string, unknown>;
  accountId?: string;
  updatedAt?: string;
}

/** Append one complete account slice to a request-local validation projection. */
function appendAppDataSlice(target: AppData, slice: AppData): void {
  for (const key of APP_DATA_KEYS) {
    const targetRows = target[key] as unknown[];
    targetRows.push(...slice[key]);
  }
}

// Tenant-ownership predicate shared by every mutating route. A row is "owned" by
// `accountId` when there's no existing row yet (a fresh upsert), or its stored accountId
// matches. PUT/PATCH use it to keep accountId IMMUTABLE (409 on a change that would re-home
// a row across the tenant boundary); DELETE uses it to scope a delete to its owner (404 on
// a cross-account target — the server analog of the client's findOwned guard). One
// predicate, so a future write path can't silently skip the check.
const ownsRow = (existing: { accountId?: unknown } | undefined, accountId: unknown): boolean =>
  !existing || existing.accountId === accountId;

/** A client may echo the deterministic Internal row immediately after creating its account in the
 * same batch. Accept that protected duplicate only when every stored client field is already the
 * exact server-generated value. Persistence timestamps are server-owned, so compare them after
 * pinning the no-op candidate to the generated revision returned in the receipt. */
function matchesMintedInternalClient(existing: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
  const normalized: Record<string, unknown> = {
    ...incoming,
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt,
  };
  return TABLES.clients.columns.every(({ name }) => normalized[name] === existing[name]);
}

// Resolve the Access-Control-Allow-Origin value for a request. '*' echoes the
// wildcard; an allow-list reflects the request's Origin only when it's on the list
// (and otherwise sends no ACAO header, so the browser blocks the cross-origin call).
// Requests with no Origin (curl, server-to-server, Playwright's APIRequestContext)
// are unaffected — CORS only governs browser cross-origin reads.
function resolveCorsOrigin(reqOrigin: string | undefined, allow: ReadonlySet<string>): string | null {
  return reqOrigin && allow.has(reqOrigin) ? reqOrigin : null;
}

function requestOriginIsSameOrigin(req: FastifyRequest, reqOrigin: string, trustForwarded: boolean): boolean {
  const host = req.headers.host;
  if (!host) return false;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const candidate = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const protocol = trustForwarded && (candidate === "http" || candidate === "https") ? candidate : req.protocol;
  let origin: URL;
  let reconstructed: URL;
  // Total function: BOTH the browser-set Origin AND the reconstructed `${protocol}://${host}` are
  // untrusted, attacker-/proxy-influenced strings. A broken reverse proxy (or a hand-forged request)
  // can present a Host that `new URL` rejects — 'exa mple.com', '[', 'host:port:port' — so the
  // reconstruct MUST stay inside the guard alongside the Origin parse. A prior refactor moved it out,
  // which turned an unparseable Host into an uncaught TypeError → unhandled 500. Either parse failing
  // means "cannot prove same-origin", which fails CLOSED: return false so the CSRF gate answers a
  // clean 403, never a 500.
  try {
    origin = new URL(reqOrigin);
    reconstructed = new URL(`${protocol}://${host}`);
  } catch {
    return false;
  }
  if (origin.origin === reconstructed.origin) return true;
  // TLS-termination fallback (no Fetch Metadata, forwarded-proto not trusted). The standard
  // reverse-proxy pattern terminates HTTPS at the edge and forwards CLEARTEXT to this process, so
  // the browser-set Origin claims `https://<host>` while req.protocol only ever sees `http`. When
  // the Origin's host:port matches our Host header and the ONLY difference is that scheme upgrade,
  // treat it as same-origin. This is safe because the BROWSER — not the caller — populates the
  // Origin host: an attacker on another site cannot forge `https://<our-host>` as their Origin.
  // The residual accepted risk is narrow: a misconfigured deployment that genuinely serves plain
  // HTTP on the same host:port it advertises as HTTPS would be treated as same-origin — an operator
  // error, not an attacker-reachable one. We deliberately do NOT accept the reverse (Origin http
  // while we are https) and never accept any host:port mismatch.
  return origin.protocol === "https:" && reconstructed.protocol === "http:" && origin.host === reconstructed.host;
}

/** Build the absolute URL Better Auth requires from Fastify's relative request URL. Host is
 * proxy/client input, so malformed authority syntax is a bounded caller error, not an exception. */
function authenticationRequestUrl(req: FastifyRequest): URL | null {
  try {
    return new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  } catch {
    return null;
  }
}

/** Batch-internal stale-write signal (optimistic concurrency, fix parity with the direct PUT
 *  route). Carries the STORED row so the batch handler can send the direct route's exact 409
 *  shape (`{ error, current }`). It is thrown from INSIDE tx(), so by construction the whole
 *  batch has already rolled back by the time the handler catches it — all-or-nothing, no op from
 *  the conflicted batch persists. NOT a ValidationError: this is a conflict (409), not a
 *  malformed request (400), and it must never be re-classified by statusFor. */
class StaleWriteError extends Error {
  constructor(readonly current: Record<string, unknown>) {
    super("The record was modified more recently on the server.");
    this.name = "StaleWriteError";
  }
}

/** Internal control signal: a post-lock batch authorization recheck already sent its refusal. */
class BatchAuthorizationResponseSent extends Error {}

/**
 * The stale-write predicate (optimistic concurrency), shared by the direct PUT route and the batch
 * PUT loop so the two paths can never drift. An existing-row replacement must echo the exact
 * server revision; a caller-authored future value is not evidence of freshness. Partial PATCH may
 * omit the precondition for compatibility, but a supplied malformed or mismatched value conflicts.
 */
function isStaleWrite(
  existing: Record<string, unknown> | undefined,
  row: Record<string, unknown>,
  requirePrecondition = true,
): existing is Record<string, unknown> {
  // (A type GUARD, not a plain boolean: both call sites feed `existing` to redactWriteEcho inside
  // the 409 branch, which needs the `existing`-is-present narrowing the old inline check gave.)
  if (existing === undefined) return false;
  // A corrupt STORED revision must remain repairable rather than write-bricked. Incoming full-row
  // writes, however, require a valid exact precondition; PATCH retains its documented omission-only
  // compatibility path while rejecting an explicitly malformed value.
  if (typeof existing.updatedAt !== "string" || !Number.isFinite(Date.parse(existing.updatedAt))) return false;
  if (typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt))) {
    return requirePrecondition || Object.hasOwn(row, "updatedAt");
  }
  return Date.parse(existing.updatedAt) !== Date.parse(row.updatedAt);
}

/** Fully visible writer context (unaffected tables, auth OFF, or an owner). One frozen module-level
 * instance keeps the hot generic write paths allocation-free. */
const ALL_FIELDS_VISIBLE: SanitizeWriteOptions = Object.freeze({
  canSeeTimeOffNote: true,
  canSeePrivateNames: true,
});

/** Project the final top-level account count for an already shape-validated batch. */
function projectBatchAccounts(db: Db, ops: BatchOp[]): { count: number; createsFinalAccount: boolean } {
  let count = countAccounts(db);
  const originalExistence = new Map<string, boolean>();
  const projectedExistence = new Map<string, boolean>();
  for (const op of ops) {
    if (op.table !== "accounts") continue;
    let exists = projectedExistence.get(op.id);
    if (exists === undefined) {
      exists = Boolean(getRow(db, "accounts", op.id));
      originalExistence.set(op.id, exists);
    }
    if (op.method === "PUT" && !exists) count += 1;
    if (op.method === "DELETE" && exists) count -= 1;
    projectedExistence.set(op.id, op.method === "PUT");
  }
  return {
    count,
    createsFinalAccount: [...projectedExistence].some(([id, exists]) => exists && originalExistence.get(id) === false),
  };
}

/**
 * WHO may create a new company right now — the ONE predicate behind both POST /api/orgs' GATE 1
 * and the `canCreateAccount` flag /api/auth/me advertises, shared so the advertised capability
 * can never drift from the enforced gate (the bug this closed: /me computed the flag from the
 * instance cap alone, so an editor / membership-less user saw a "New company" affordance whose
 * POST always 403'd). True iff ANY of:
 *   (1) ZERO accounts exist — first-run bootstrap (anyone may create the very first org);
 *   (2) authMode 'off' (trusted-local — the caller is DEMO_USER);
 *   (3) auth-on: the caller is an ACTIVE Owner/Admin of SOME existing account
 *       (can(role, 'manageMembers') = admin-tier).
 * POST /api/orgs additionally accepts a valid bootstrap token (its arm (4), checked at the
 * route) — that arm deliberately stays OUT of this predicate: the token travels in a curl
 * header, never in a browser session, so it must never light up the client's "New company"
 * affordance for a caller who can't actually present it.
 *
 * WHO only — the single-company cap (WHETHER a new company may exist; accountCreateCapped) is a
 * separate gate the callers apply themselves.
 */
async function userMayCreateAccount(
  db: Db,
  administration: AccountAdminPort,
  authMode: AuthMode,
  userId: string,
): Promise<boolean> {
  return (
    countAccounts(db) === 0 || // (1) first-run bootstrap
    authMode === "off" || // (2) trusted-local — the caller is DEMO_USER
    // (3) an ACTIVE owner/admin of ANY existing account (admin-tier = can manageMembers).
    (await administration.listWorkspacesForPrincipal({ principalId: userId })).some((membership) =>
      can(membership.role, "manageMembers"),
    )
  );
}

// SQLite extended constraint codes that describe caller-supplied row data. Deliberately exclude
// TRIGGER (1811), FUNCTION (1043), VTAB (2323), COMMIT_HOOK (531) and other internal constraint
// sources: those are server/storage failures and must remain logged 500s.
const SQLITE_CALLER_DATA_CONSTRAINT_CODES = new Set([
  275, // SQLITE_CONSTRAINT_CHECK
  787, // SQLITE_CONSTRAINT_FOREIGNKEY
  1299, // SQLITE_CONSTRAINT_NOTNULL
  1555, // SQLITE_CONSTRAINT_PRIMARYKEY
  2067, // SQLITE_CONSTRAINT_UNIQUE
  2579, // SQLITE_CONSTRAINT_ROWID
  3091, // SQLITE_CONSTRAINT_DATATYPE
]);

/** node:sqlite exposes SQLite's extended numeric result in `errcode`. Require both its error code
 * and one recognized row-data constraint subtype so unrelated prose and internal trigger aborts
 * can never be hidden as caller faults. */
function isSqliteConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const sqlite = err as Error & { code?: unknown; errcode?: unknown };
  return (
    sqlite.code === "ERR_SQLITE_ERROR" &&
    typeof sqlite.errcode === "number" &&
    Number.isInteger(sqlite.errcode) &&
    SQLITE_CALLER_DATA_CONSTRAINT_CODES.has(sqlite.errcode)
  );
}

// Map a thrown error to an HTTP status. Caller-fault errors — domain validation
// (ValidationError) and DB constraint/FK violations — are 400; anything else is an
// unexpected server/db bug and must surface as 500 (not be hidden as a 400).
// Exported for unit testing the classification.
export function statusFor(err: unknown): number {
  if (err instanceof ValidationError) return 400;
  if (isSqliteConstraintError(err)) return 400;
  return 500;
}

/** Resolve the client identity consistently for rate limiting and security telemetry. */
export function requestClientIp(request: Pick<FastifyRequest, "headers" | "ip">, trustProxyHeaders: boolean): string {
  if (trustProxyHeaders) {
    const forwarded = request.headers["x-forwarded-for"];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.ip;
}

function fail(reply: FastifyReply, err: unknown, logError: (e: unknown) => void = console.error) {
  const status = statusFor(err);
  // A 500 is an unexpected server/db bug: log the real error server-side but return a
  // GENERIC body so we never leak internals (stack-ish messages, SQL, paths).
  if (status === 500) {
    logError(err);
    return reply.code(500).send({ error: "Internal server error" });
  }
  // 400s: a curated ValidationError message is safe AND useful (it's a friendly sentence we
  // authored). A raw DB-constraint message (e.g. "NOT NULL constraint failed: clients.color")
  // leaks schema internals — genericise it, mirroring the 500 redaction one tier down.
  const message =
    err instanceof ValidationError
      ? err.message
      : "That change references missing data or conflicts with an existing record.";
  return reply.code(status).send({
    error: message,
    ...(err instanceof ValidationError && err.code ? { code: err.code } : {}),
  });
}

/** Stamp `ts` and assemble the 7-field {@link AuditRecord} shared by the generic
 *  POST/PUT/PATCH/DELETE handlers. */
function buildAuditRecord(
  userId: string,
  accountId: string,
  action: AuditRecord["action"],
  entity: string,
  id: string,
  changedFields: string[],
): AuditRecord {
  return { ts: new Date().toISOString(), userId, accountId, action, entity, id, changedFields };
}

export function buildApp(db: Db, opts: AppOptions = {}): FastifyInstance {
  const authMode = opts.authMode ?? "off";
  const auth = opts.auth ?? null;
  const configuredRateLimit = opts.rateLimit ?? 0;
  const rateLimitMax = normalizeRateLimit(configuredRateLimit);
  if (configuredRateLimit !== 0 && rateLimitMax === 0) {
    throw new RangeError(
      `rateLimit must be 0 (disabled) or a positive integer no greater than ${MAX_RATE_LIMIT.toLocaleString("en-US")}.`,
    );
  }
  // Misconfiguration, not a request-time condition: fail at construction, loudly.
  if (authMode !== "off" && !auth) {
    throw new Error(`buildApp: authMode '${authMode}' requires a Better Auth instance (opts.auth)`);
  }
  if (opts.bootstrapToken && Buffer.byteLength(opts.bootstrapToken, "utf8") < MIN_BOOTSTRAP_TOKEN_BYTES) {
    throw new Error(`CAPACITYLENS_BOOTSTRAP_TOKEN must be at least ${MIN_BOOTSTRAP_TOKEN_BYTES} bytes.`);
  }
  const application = opts.application ?? DEFAULT_ACCOUNT_APPLICATION;
  const applicationFailure = boundApplicationFailure(application);
  if (applicationFailure) throw new Error(`buildApp: ${applicationFailure}`);
  const executeImportWorker = opts.importWorker ?? runImportWorker;
  // One fail-never sink receives both legacy product mutation records and normalized account-flow
  // events. Construct it before the account boundary so the coordinator—not its HTTP caller—owns
  // audit correlation for cross-port commands.
  const auditSink = opts.audit ?? noopAuditSink();
  // Recover records committed before a prior process stopped between SQLite COMMIT and delivery.
  // A sink failure remains a soft health signal and leaves the oldest row queued for the next
  // request/restart; malformed durable rows throw because silently skipping one would break the
  // completeness contract the outbox exists to provide.
  const auditDrainer = createAuditOutboxDrainer(db, auditSink, () => {
    console.error(JSON.stringify({ level: "error", event: "audit_outbox_background_drain_failed" }));
  });
  const repliesWithAuditDrain = new WeakSet<FastifyReply>();
  auditDrainer.drainOnce();
  // Account coordinators write stable event ids through the same durable outbox as product
  // mutations. Their append boundary means "durably accepted", not "already delivered"; the
  // response hook below performs best-effort delivery after any enclosing transaction commits.
  const accountAudit = {
    append: (event: AccountAuditEvent) => {
      enqueueAudit(db, event, event.id);
      return true;
    },
  };
  const accountLock = new KeyedOperationLock();
  const identityPort =
    auth && authMode !== "off"
      ? betterAuthIdentityPort({
          applicationId: application.applicationId,
          auth,
          authMode,
          db,
        })
      : trustedLocalIdentityPort({
          id: DEMO_USER.id,
          displayName: DEMO_USER.name,
          email: DEMO_USER.email,
          emailVerified: true,
          linkedSubject: null,
        });
  const accountAdminPort = sqliteAccountAdminPort({
    applicationId: application.applicationId,
    db,
    lock: accountLock,
    trustedLocal: authMode === "off",
    requireMfa: authMode === "password" && opts.requireMfa === true,
    audit: accountAudit,
  });
  const accountFlows = localAccountFlows({
    applicationId: application.applicationId,
    db,
    identity: identityPort,
    administration: accountAdminPort,
    lock: accountLock,
    eraseProductWorkspaceInTx: (workspaceId) => eraseWorkspaceProductDataInTx(db, workspaceId),
    audit: accountAudit,
  });
  const logOn = opts.log === true;
  const app = Fastify({
    ...(opts.internalTls ? { https: opts.internalTls } : {}),
    bodyLimit: BODY_LIMIT,
    requestTimeout: REQUEST_TIMEOUT_MS,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    // CAPACITYLENS_LOG=1 turns on Fastify's bundled pino (JSON to stdout; no new dependency).
    // ON always attaches the redact config (both branches) so a secret can never reach the
    // logs — see LOG_REDACT_PATHS. Off ⇒ logger disabled entirely — today's behaviour, byte for byte.
    // requestLoggerOptions also owns invite/query URL masking and reconstructs Fastify's request
    // serializer so method/hostname/remote address remain available without emitting headers.
    logger: logOn ? requestLoggerOptions(opts.logStream) : false,
  });
  app.addHook("onClose", () => auditDrainer.stop());
  app.addHook("onRequest", (request, reply, done) => {
    const controller = new AbortController();
    request.raw.once("aborted", () => controller.abort(new Error("The request was aborted.")));
    reply.raw.once("close", () => {
      if (!reply.raw.writableFinished) controller.abort(new Error("The client disconnected."));
    });
    runWithRequestAbortSignal(controller.signal, done, (queue, reason) => {
      securityEvent({
        event: "password_security_queue_saturated",
        outcome: "blocked",
        queue,
        reason,
        method: request.method,
        path: request.url.split("?", 1)[0],
        remoteIp: requestClientIp(request, opts.trustProxyHeaders === true),
      });
    });
  });
  // A finite process-wide socket ceiling gives the reverse proxy a deterministic overload signal
  // instead of allowing unbounded accepted connections to consume memory/file descriptors.
  app.server.maxConnections = MAX_SERVER_CONNECTIONS;
  // Fail-closed: an omitted corsOrigin locks to the localhost allow-list, NOT a wildcard.
  const corsOrigin = opts.corsOrigin ?? DEFAULT_CORS;
  const corsOrigins = new Set(
    corsOrigin
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((configuredOrigin) => {
        if (configuredOrigin === "*") {
          throw new Error("CORS requires explicit origins when cookie authentication is enabled.");
        }
        let parsed: URL;
        try {
          parsed = new URL(configuredOrigin);
        } catch (cause) {
          throw new Error(`Invalid CORS origin ${JSON.stringify(configuredOrigin)}: expected a bare HTTP(S) origin.`, {
            cause,
          });
        }
        if (
          (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
          parsed.username !== "" ||
          parsed.password !== "" ||
          parsed.pathname !== "/" ||
          parsed.search !== "" ||
          parsed.hash !== ""
        ) {
          throw new Error(
            `Invalid CORS origin ${JSON.stringify(configuredOrigin)}: expected a bare HTTP(S) origin without credentials, a path, query, or fragment.`,
          );
        }
        return parsed.origin;
      }),
  );
  // 500s with logging ON go through the request-scoped logger (one parseable JSON line,
  // correlated with the request); OFF keeps today's bare console.error.
  const sendFail = (reply: FastifyReply, err: unknown) =>
    fail(reply, err, logOn ? (e: unknown) => reply.log.error(e) : undefined);
  const accountFail = (reply: FastifyReply, err: unknown) => {
    if (!(err instanceof AccountContractError)) return sendFail(reply, err);
    const retryAfterSeconds =
      typeof err.failure.retryAfterSeconds === "number" &&
      Number.isFinite(err.failure.retryAfterSeconds) &&
      err.failure.retryAfterSeconds >= 0
        ? err.failure.retryAfterSeconds
        : undefined;
    if (retryAfterSeconds !== undefined) reply.header("retry-after", String(Math.ceil(retryAfterSeconds)));
    return reply.code(statusForAccountFailure(err.failure)).send({
      error: err.failure.message,
      code: err.failure.code,
      retryable: err.failure.retryable,
      ...(err.failure.commandId ? { commandId: err.failure.commandId } : {}),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  };
  const securityEvent = (event: Record<string, unknown>): void => {
    try {
      // Central path-secret boundary: every security event passes here, including early auth/MFA/
      // rate-limit refusals. A caller cannot accidentally bypass invite-token redaction by logging
      // the raw request path instead of remembering to sanitize it at each event site.
      const safeEvent = typeof event.path === "string" ? { ...event, path: redactSecretUrl(event.path) } : event;
      opts.securityLog?.(safeEvent);
    } catch (error) {
      // A monitoring transport must never turn a safe refusal into an application outage.
      if (logOn) app.log.error(error, "security event logging failed");
      else console.error("capacitylens-server: security event logging failed");
    }
  };

  // Node emits `drop` when maxConnections refuses a newly accepted socket. Keep the signal
  // privacy-safe and rate-limited: an overload must be visible without turning a connection storm
  // into a logging storm.
  let lastConnectionLimitEventAt = Number.NEGATIVE_INFINITY;
  app.server.on("drop", () => {
    const now = Date.now();
    if (now - lastConnectionLimitEventAt < 60_000) return;
    lastConnectionLimitEventAt = now;
    securityEvent({
      event: "connection_limit",
      outcome: "blocked",
      limit: MAX_SERVER_CONNECTIONS,
    });
  });

  // Single redaction funnel for any UNCAUGHT throw (a route that forgot a try/catch, a
  // SQLITE_BUSY thrown mid-statement). Positively identified parsing errors carry safe messages.
  // A duck-typed statusCode alone proves nothing about message safety; unknown errors route through
  // fail() so a 500 stays generic and a 400 DB-constraint message cannot leak schema internals.
  app.setErrorHandler((err, req, reply) => {
    const errorStatus = (err as { statusCode?: unknown }).statusCode;
    if (typeof errorStatus === "number" && Number.isInteger(errorStatus) && errorStatus >= 500 && errorStatus <= 599) {
      securityEvent({
        event: "unexpected_error",
        outcome: "failure",
        method: req.method,
        path: req.url,
        status: errorStatus,
      });
      if (logOn) req.log.error(err);
      else console.error(err);
      return reply.code(errorStatus).send({ error: "Internal server error" });
    }
    const safe = safeClientError(err);
    if (safe) {
      return reply.code(safe.status).send({ error: safe.message });
    }
    return sendFail(reply, err);
  });

  // Browsers use non-JSON media types for CSP reports. Parse them as bounded JSON so malformed or
  // oversized telemetry is rejected before the handler and can never become a logging DoS path.
  app.addContentTypeParser(
    ["application/csp-report", "application/reports+json"],
    { parseAs: "string", bodyLimit: CSP_REPORT_BODY_LIMIT },
    (_req, body, done) => {
      try {
        done(null, JSON.parse(typeof body === "string" ? body : body.toString("utf8")));
      } catch {
        const error = new Error("Malformed CSP report") as Error & {
          code: string;
          statusCode: number;
        };
        error.code = "CAPACITYLENS_MALFORMED_CSP_REPORT";
        error.statusCode = 400;
        done(error, undefined);
      }
    },
  );

  // Baseline security headers (P0.5.3, @fastify/helmet): ON by default — these are pure
  // hardening with no precondition, for an API server that returns JSON only (the SPA is
  // served by Nginx, not here). Registered EARLY, before route plugins, so its onRequest
  // hook decorates every response. helmet defaults already give us nosniff
  // (X-Content-Type-Options) and X-Frame-Options: DENY (frameguard) for legacy browsers; we
  // add a strict, minimal CSP whose frame-ancestors 'none' is the modern clickjacking guard,
  // and a no-referrer Referrer-Policy. The CSP carries exactly the minimal API directives plus
  // legacy and current reporting targets — useDefaults:false below keeps
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
        "default-src": ["'self'"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
        "report-uri": ["/api/security/csp-report"],
        "report-to": ["csp-endpoint"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    // X-Frame-Options: DENY for legacy browsers (helmet's default is SAMEORIGIN); the modern
    // equivalent is the CSP frame-ancestors 'none' above. This API is never framed, so DENY.
    frameguard: { action: "deny" },
    // OFF over HTTP (the default deploy: HTTP behind a TLS-terminating proxy); only emitted
    // when the operator asserts real HTTPS fronts the origin (opts.https / CAPACITYLENS_HTTPS=1).
    hsts: opts.https === true ? { maxAge: 63072000, includeSubDomains: true } : false,
  });

  // Rate limiting (P1.5, flag CAPACITYLENS_RATE_LIMIT): registered ONLY when a positive limit
  // was configured — off means the plugin doesn't exist in the app at all. Keyed per IP;
  // behind the Nginx proxy every socket is loopback, so trustProxyHeaders swaps the
  // key to the first X-Forwarded-For hop there (and only there). 429s flow through the
  // setErrorHandler above, so the refusal is the API's usual { error } JSON shape.
  if (rateLimitMax > 0) {
    void app.register(rateLimitPlugin, {
      max: rateLimitMax,
      timeWindow: "1 minute",
      // Give the global redaction funnel positive provenance and let it return canonical text.
      // @fastify/rate-limit's default error has only a duck-typed statusCode, indistinguishable
      // from an arbitrary thrown object whose message could contain internal details.
      errorResponseBuilder: (_req, context) =>
        Object.assign(new Error("Rate limit exceeded"), {
          code: "CAPACITYLENS_RATE_LIMITED",
          statusCode: context.statusCode,
        }),
      keyGenerator: (req: FastifyRequest) => {
        return requestClientIp(req, opts.trustProxyHeaders === true);
      },
    });
  }

  // ASVS v5.0.0 V14.3.2: authenticated/API data must never be retained by a browser,
  // intermediary, or shared cache. Apply this at the root so Better Auth responses, errors,
  // health, and every custom route share one invariant. `no-store` is the normative control;
  // the legacy Pragma header protects older HTTP/1.0 intermediaries.
  app.addHook("onSend", async (req: FastifyRequest, reply: FastifyReply, payload) => {
    if (req.url.split("?", 1)[0].startsWith("/api/")) {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
      reply.header("Reporting-Endpoints", 'csp-endpoint="/api/security/csp-report"');
      // Account flows enqueue while their coordinator transaction may still be open. Deliver only
      // after the handler has completed, preserving committed rows whenever the sink is degraded.
      if (db.isOpen && !repliesWithAuditDrain.has(reply) && !auditDrainer.drainOnce()) {
        reply.header("x-capacitylens-audit-warning", "true");
      }
    }
    return payload;
  });

  app.addHook("onResponse", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split("?", 1)[0];
    const authOperation =
      req.method !== "OPTIONS" &&
      /^\/api\/auth\/(sign-in|sign-out|callback|oauth2\/callback|two-factor|change-password|reset-password)/.test(path);
    if (authOperation) {
      securityEvent({
        event: "authentication",
        outcome: reply.statusCode < 400 ? "success" : "failure",
        method: req.method,
        path,
        status: reply.statusCode,
        remoteIp: requestClientIp(req, opts.trustProxyHeaders === true),
        ...(req.authenticationUserId === null ? {} : { userId: req.authenticationUserId }),
      });
    } else if (reply.statusCode === 429) {
      securityEvent({
        event: "rate_limit",
        outcome: "blocked",
        method: req.method,
        path,
        status: 429,
        remoteIp: requestClientIp(req, opts.trustProxyHeaders === true),
      });
    }
  });

  // requireUser — ONE gate for everything under /api/ except /api/health (the
  // uptime monitor has no session) and /api/auth/* (the login machinery itself; our
  // /api/auth/me handles its own 401). Root-level so child routes inherit it; preHandler
  // only fires for MATCHED routes, so 404s and the CORS preflight 204 are unaffected.
  // 'off' attaches the synthetic demo identity and continues — no request that succeeds
  // today may fail. Other modes resolve the Better Auth session or 401.
  app.decorateRequest("user", null);
  app.decorateRequest("accountActor", null);
  app.decorateRequest("authenticationUserId", null);
  app.decorateRequest("authenticationProviderId", null);
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split("?", 1)[0];
    if (
      !path.startsWith("/api/") ||
      path === "/api/health" ||
      path === "/api/security/csp-report" ||
      path.startsWith("/api/auth/")
    )
      return;
    // A genuinely new password user has no session yet. Signup is authorized by the unexpired
    // single-use invite bearer token. Preview is also bearer-authorized and returns only the company
    // display name, proposed role and expiry — never tenant rows, members or identity facts.
    if (/^\/api\/invites\/[^/]+\/signup$/.test(path)) return;
    if (req.method === "GET" && /^\/api\/invites\/[^/]+\/preview$/.test(path)) return;
    if (req.method === "POST" && path === "/api/account-commands/reconcile") return;
    if (authMode === "off") {
      req.user = DEMO_USER;
      req.accountActor = {
        principalId: DEMO_USER.id,
        sessionId: "trusted-local",
        assurance: "trusted-local",
        fresh: true,
        mfaSatisfied: true,
      };
      return;
    }
    try {
      const session = await identityPort!.verifyApplicationSession({
        headers: toWebHeaders(req.headers),
      });
      if (!session) {
        securityEvent({
          event: "authentication_required",
          outcome: "blocked",
          method: req.method,
          path,
          remoteIp: requestClientIp(req, opts.trustProxyHeaders === true),
        });
        return reply.code(401).send({ error: "Sign in to continue." });
      }
      const user = sessionUserFromApplicationSession(session);
      req.user = user;
      req.accountActor = actorContextFromSession(session);
      req.authenticationProviderId = session.assurance === "federated" ? session.providerId : null;
      if (authMode === "password" && opts.requireMfa === true && !sessionSatisfiesRequiredMfa(session)) {
        securityEvent({
          event: "mfa_required",
          outcome: "blocked",
          method: req.method,
          path,
          userId: user.id,
        });
        return reply.code(403).send({
          error: "Multi-factor authentication enrollment is required.",
          code: "MFA_ENROLLMENT_REQUIRED",
        });
      }
    } catch (e) {
      // The auth backend (Better Auth / its DB) FAILED — this is NOT "no session". CRITICAL: do
      // not fall through leaving req.user null while letting the handler run (that would serve an
      // UNAUTHENTICATED request). Reject with a 503 (distinct from a credentials-style 401);
      // returning a reply from a preHandler short-circuits the route, so the handler never executes.
      req.log.error(e);
      return reply.code(503).send({ error: "Sign-in is temporarily unavailable." });
    }
  });

  // Deep mode prepares the trivial read ONCE, here in the synchronous factory body while
  // the DB is known-open; a later closed/corrupt/locked DB makes get() throw at request
  // time, which is exactly the signal the uptime monitor needs (a bare { ok: true } from
  // a server whose DB is broken is a lie).
  const healthStmt = opts.healthDeep === true ? db.prepare("SELECT 1") : null;

  // Forward coordinator-owned account/control events that do not represent AppData mutations.
  // Product mutations use commitProductAudit below so their audit row shares the data transaction.
  // append() never throws (see audit.ts); a degraded direct sink remains a soft health signal.
  const audit = (reply: FastifyReply, record: AuditRecord): void => {
    if (!auditSink.append(record)) reply.header("x-capacitylens-audit-warning", "true");
  };

  const drainProductAudit = (reply: FastifyReply): boolean => {
    repliesWithAuditDrain.add(reply);
    const ok = auditDrainer.drainOnce();
    if (!ok) reply.header("x-capacitylens-audit-warning", "true");
    return ok;
  };

  const commitProductAudit = (reply: FastifyReply, record: AuditRecord, mutation: () => void): boolean => {
    tx(
      db,
      () => {
        mutation();
        enqueueAudit(db, record);
      },
      "immediate",
    );
    return drainProductAudit(reply);
  };

  // The tenant-scoping storage seam: account-keyed reads, validation projections and lifecycle
  // operations enforce the no-cross-tenant contract in one shared-SQLite implementation. Built once
  // here (factory state, like healthStmt) so the same instance backs every request.
  const store = sqliteTenantStore(db);

  /**
   * The authorization seam (P1.5 requirePermission): "may THIS request perform `action` on
   * `accountId`?". Returns `true` to proceed; otherwise it has already sent the route's denial and returns
   * `false`, so a caller guards with `if (!authorize(...)) return`.
   *
   * OFF mode (the default, trusted-local) is a NO-OP allow-all: it returns `true` on the FIRST line,
   * BEFORE any membership read — `req.user` is the synthetic DEMO_USER and the account port / `can`
   * never run. This pins the #1 invariant (OFF = exactly today's behaviour). Auth-on asks the account
   * administration port for the caller's active role and runs the pure `can(role, action)` matrix:
   *   - non-member (`role === null`) → 403,
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
   * @param options    Row-addressed routes may conceal non-membership as the same 404 as an absent id.
   * @returns `true` if allowed; `false` after sending the route's denial response.
   */
  function authorize(
    req: FastifyRequest,
    reply: FastifyReply,
    accountId: string,
    action: Action,
    options: { concealNonMembership?: boolean } = {},
  ): boolean {
    if (authMode === "off") return true; // OFF = allow-all; the account port / can NEVER run.
    const role = accountAdminPort.roleForPrincipalInWorkspace(req.user!.id, accountId);
    if (role === null) {
      securityEvent({
        event: "authorization",
        outcome: "denied",
        action,
        accountId,
        userId: req.user?.id,
      });
      if (options.concealNonMembership) reply.code(404).send({ error: "Not found" });
      else reply.code(403).send({ error: "Forbidden." });
      return false;
    }
    if (!can(role, action)) {
      securityEvent({
        event: "authorization",
        outcome: "denied",
        action,
        accountId,
        userId: req.user?.id,
        role,
      });
      reply.code(403).send({ error: "Forbidden." }); // member, but role tier too low for action
      return false;
    }
    if (action !== "read" && action !== "write") {
      // Freshness gate for privileged (above-write) actions — FAIL CLOSED (mirrors the CSRF-parse
      // and needsSetup posture): a session whose creation time is missing or unparseable cannot be
      // proven fresh, so it counts as stale. The old `sessionCreatedAt !== undefined &&` guard
      // BYPASSED step-up for exactly those sessions — fail-open on a security gate. Recovery is the
      // client's re-auth dialog: a fresh sign-in always mints a session with a timestamp
      // (auth.api.getSession derives sessionCreatedAt from the session row), so no one is hard-stuck.
      // Date.parse(undefined ?? '') is NaN, and NaN fails Number.isFinite → stale.
      // INCLUSIVE at the deadline (`>=`, matching enforceSessionActivity): a session sitting
      // exactly on the freshness bound is stale, not fresh — a stated security bound is the last
      // safe instant, not the first unsafe one.
      const sessionCreatedAtMs = Date.parse(req.user?.sessionCreatedAt ?? "");
      const timestampMissing = !Number.isFinite(sessionCreatedAtMs);
      if (timestampMissing || Date.now() - sessionCreatedAtMs >= ACCOUNT_SESSION_FRESH_AGE_SECONDS * 1000) {
        securityEvent({
          event: "step_up_required",
          outcome: "blocked",
          action,
          accountId,
          userId: req.user?.id,
          // Distinguish "we could not date this session" from an ordinarily aged-out one — an
          // operator seeing this on real sessions has a session-record integrity problem, not users
          // idling past the freshness window.
          ...(timestampMissing ? { reason: "missing_session_timestamp" } : {}),
        });
        reply.code(403).send({
          error: "Sign in again before performing this security-sensitive action.",
          code: "SESSION_NOT_FRESH",
        });
        return false;
      }
    }
    return true;
  }

  /** Writer visibility for the two field-level confidentiality policies. Only time off and
   * client/project writes pay the membership lookup; a non-string account id fails closed. */
  function fieldVisibilityFor(req: FastifyRequest, table: string, accountId: unknown): SanitizeWriteOptions {
    // No gated fields on this table (or trusted-local OFF) ⇒ fully visible, no membership lookup.
    if (!tableHasGatedFields(table) || authMode === "off") {
      return ALL_FIELDS_VISIBLE;
    }
    const role =
      typeof accountId === "string" ? accountAdminPort.roleForPrincipalInWorkspace(req.user!.id, accountId) : null; // a non-string account id fails closed (every gated field hidden)
    return visibilityForRole(role);
  }

  /** Apply every field-level confidentiality projection (GATED_FIELD_POLICIES) to write/conflict/
   * lifecycle response echoes. A write response is also a read and must never bypass the main
   * state-read policy. */
  function redactWriteEcho(
    table: string,
    row: Record<string, unknown>,
    vis: SanitizeWriteOptions,
  ): Record<string, unknown> {
    return redactGatedEcho(table, row, vis);
  }

  // CORS response headers are not a CSRF control: browsers can still SEND a simple form request
  // and merely hide the response. Reject unsafe cross-site browser requests before routing, then
  // add CORS headers for explicitly trusted origins. Requests without Origin/Sec-Fetch-Site are
  // retained for CLI/server clients; modern browsers supply at least one signal for a cross-site
  // unsafe request. This hook MUST live on the ROOT instance, not in the routes child
  // below: there are no OPTIONS routes, so a preflight takes the not-found path, and
  // only root-level hooks run there — a child-scoped hook would leave preflights as
  // bare 404s without CORS headers, silently blocking every cross-origin write.
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const listedOrigin = resolveCorsOrigin(req.headers.origin, corsOrigins);
    const fetchSite = req.headers["sec-fetch-site"];
    // Sec-Fetch-Site is a forbidden browser-controlled header and therefore the most direct signal
    // for the packaged proxy path (where an outer TLS edge or non-default port can make server-side
    // origin reconstruction ambiguous). Exact scheme/Host comparison remains the fallback for
    // older clients that do not send Fetch Metadata. trustProxyHeaders is the shared deployment
    // posture: it also controls X-Forwarded-For rate-limit identity above, and only trusted proxies
    // that overwrite both headers may enable it.
    const sameOrigin =
      fetchSite === "same-origin" ||
      (req.headers.origin !== undefined &&
        requestOriginIsSameOrigin(req, req.headers.origin, opts.trustProxyHeaders === true));
    const origin = listedOrigin ?? (sameOrigin ? req.headers.origin! : null);
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    // An Origin exactly on the credentialed CORS allow-list (listedOrigin, folded into `origin`
    // above) is the operator's EXPLICIT cross-site contract, so it passes the gate regardless of
    // Fetch Metadata — a `Sec-Fetch-Site: cross-site` on an allow-listed Origin is exactly the
    // legitimate configured cross-origin call, not an attack. We therefore block only when the
    // request resolved to NO trusted origin (`origin === null`, i.e. neither allow-listed nor
    // same-origin) AND there is a cross-site signal: an Origin header we could not trust, or an
    // explicit cross-site Fetch Metadata label (which also catches Origin-less browser writes).
    if (unsafe && origin === null && (req.headers.origin !== undefined || fetchSite === "cross-site")) {
      securityEvent({
        event: "cross_site_request",
        outcome: "blocked",
        method: req.method,
        path: req.url,
        origin: req.headers.origin,
        fetchSite,
      });
      return reply.code(403).send({ error: "Cross-site request rejected." });
    }
    if (origin) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Credentials", "true");
    }
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    reply.header("Access-Control-Expose-Headers", "x-capacitylens-audit-warning");
    // Static allow-list: Content-Type plus the explicit account-bootstrap and first-owner setup
    // secret headers. Never reflect arbitrary requested headers on credentialed origins.
    reply.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Idempotency-Key, x-account-command-id, x-capacitylens-bootstrap-token, x-capacitylens-setup-token, x-capacitylens-sync-session, x-capacitylens-sync-sequence",
    );
    if (req.method === "OPTIONS") reply.code(204).send();
  });

  // Every route below registers through a child plugin, NOT directly on the root:
  // @fastify/rate-limit attaches to routes via an onRoute hook that only exists once the
  // plugin LOADS (at ready(), in registration order) — a route declared straight on the
  // root would register first and silently escape the limiter. The child loads after it,
  // so its routes are seen, and it inherits the root CORS hook + error handler. The
  // callback shadows `app` deliberately: the route code is identical without the wrapper.
  void app.register(async (app) => {
    // Public browser telemetry endpoint. It returns no data, accepts only bounded JSON media types,
    // is covered by the normal IP rate limit, and logs a strict origin/directive projection rather
    // than attacker-controlled full URLs. Authentication cannot be required because a CSP failure
    // can occur before a session exists.
    app.post("/api/security/csp-report", { bodyLimit: CSP_REPORT_BODY_LIMIT }, (req, reply) => {
      for (const report of normalizedCspReports(req.body)) securityEvent(report);
      return reply.code(204).send();
    });

    // Health is deliberately constant-work AND exempt from the rate limiter (`config.rateLimit:
    // false`): an uptime monitor polls it continuously and must NEVER be told 429. Behind a proxy
    // without forwarded-IP trust every client shares one socket-IP bucket, so a limited health
    // route would let ordinary API traffic starve the monitor's probe (and vice versa). Exempting
    // it adds no amplification surface: the expensive full row-codec + foreign-key integrity
    // verification runs once during openDb(), and this handler is only a cached SELECT 1.
    app.get("/api/health", { config: { rateLimit: false } }, (_req, reply) => {
      if (!healthStmt) return { ok: true };
      try {
        healthStmt.get();
        const backupHealth = opts.backupHealth?.();
        const auditPending = auditDrainer.pendingCount();
        // P1.15: audit-degraded is a SOFT signal — keep ok:true (the DB is fine; the audit sink
        // failing a write doesn't make the server unhealthy), just surface 'degraded' so an
        // operator can see it. The SHALLOW (non-deep) health stays exactly { ok: true } above —
        // the Playwright webServer probe contract — so the audit field appears ONLY in deep mode.
        return {
          ok: true,
          db: true,
          audit: auditSink.degraded ? "degraded" : auditPending > 0 ? "recovering" : "ok",
          auditPending,
          ...(backupHealth
            ? {
                backup: {
                  status: backupHealth.degraded ? "degraded" : backupHealth.lastSuccessAt ? "ok" : "pending",
                  lastSuccessAt: backupHealth.lastSuccessAt,
                },
              }
            : {}),
          ...(opts.internalTlsExpiresAt
            ? {
                internalTls: internalTlsHealth(
                  opts.internalTlsExpiresAt,
                  Date.now(),
                  opts.internalTlsFingerprintSha256,
                ),
              }
            : {}),
        };
      } catch {
        // INTENTIONAL empty catch: the 503 IS the surfacing. A broken DB must make the uptime
        // monitor see 503 — not a lying { ok: true } 200, and not a thrown 500. Do NOT "fix" this
        // by logging-and-rethrowing; the status code is the signal the monitor needs.
        return reply.code(503).send({ ok: false });
      }
    });

    // Thin identity route — exists in EVERY mode so the client never forks on a
    // flag: { authMode, user }. 'off' reports the demo identity unconditionally; other
    // modes report the Better Auth session user, or 401 (with authMode, so the login
    // screen knows which form to show) when there is no session.
    app.get("/api/auth/me", async (req, reply) => {
      // Company-creation capability flags: the client's create-company entry point uses these to
      // hide/disable itself instead of discovering the answer via a failed POST. `canCreateAccount`
      // mirrors POST /api/orgs' full gate — (cap allows) AND userMayCreateAccount, the SAME shared
      // predicate the route enforces — never the cap alone (that told editors/membership-less users
      // "yes" and let them walk into a guaranteed 403). Recomputed PER REQUEST (account counts and
      // memberships change) — never cached — and carried on BOTH success shapes (off + authed) so
      // neither mode forks the client. The 401/503 shapes below are deliberately unchanged (no
      // account facts for a caller who isn't authenticated / whose session state is unknown) — an
      // anon caller on an auth-on instance is never told it can create.
      const multiAccount = opts.multiAccount === true;
      // The cap arm (WHETHER a new company may exist at all) — POST /api/orgs' GATE 0.
      const capAllows = !accountCreateCapped(db, multiAccount);
      if (authMode === "off") {
        // OFF mode: userMayCreateAccount is trivially true (its authMode arm), so the cap decides.
        return {
          authMode,
          user: DEMO_USER,
          providers: [],
          multiAccount,
          canCreateAccount: capAllows,
        };
      }
      try {
        const session = await identityPort!.verifyApplicationSession({
          headers: toWebHeaders(req.headers),
        });
        if (!session) {
          // First-run signal: password mode + an EMPTY user table means the setup-token-guarded
          // bootstrap is available (the live gate in auth.ts), so the login screen offers
          // "Create the owner account" instead of a dead-end sign-in. "The user count is zero" is
          // NOT tenant data — the 401 shape still deliberately excludes account facts (the
          // capability flags stay off this branch); it reveals no setup secret or account data.
          const needsSetup = authMode === "password" && countUsers(db) === 0;
          return reply.code(401).send({
            authMode,
            providers: auth?.providers ?? [],
            error: "Sign in to continue.",
            ...(needsSetup ? { needsSetup: true } : {}),
          });
        }
        const user = sessionUserFromApplicationSession(session);
        return {
          authMode,
          user,
          mfaRequired: authMode === "password" && opts.requireMfa === true && !sessionSatisfiesRequiredMfa(session),
          reauthMethod: session.assurance === "federated" ? "provider" : "password",
          reauthProviderId: session.providerId ?? null,
          providers: auth?.providers ?? [],
          multiAccount,
          canCreateAccount:
            capAllows &&
            (authMode !== "sso" ||
              (session.assurance === "federated" && session.providerId === auth?.strictProvider?.id)) &&
            (await userMayCreateAccount(db, accountAdminPort, authMode, user.id)),
        };
      } catch (e) {
        // The auth backend failed — NOT "no session". Surface a 503 with a clear, DISTINCT message
        // (the client can tell "temporarily unavailable" from a 401 "bad/again credentials") rather
        // than letting it fall through to the generic 500 redaction.
        req.log.error(e);
        return reply.code(503).send({ authMode, error: "Sign-in is temporarily unavailable." });
      }
    });

    // Better Auth's own endpoints (sign-up/sign-in/sign-out/session/OAuth callbacks),
    // mounted ONLY when auth is on — in 'off' mode this route does not exist (the OFF
    // guarantee: zero new attack surface). The static /api/auth/me above outranks this
    // wildcard in Fastify's router. Translation layer: Fastify req → web Request,
    // web Response → Fastify reply (set-cookie kept as separate headers; content-length
    // recomputed by Fastify).
    if (authMode !== "off" && auth) {
      registerSsoCutoverRoutes(app, {
        auth,
        authMode,
        identity: identityPort as SsoCutoverIdentityPort,
        administration: accountAdminPort,
        applicationId: application.applicationId,
        openSignup: opts.allowOpenSignup === true,
        authorize,
        fail: accountFail,
        toWebHeaders,
      });
      app.route({
        method: ["GET", "POST"],
        url: "/api/auth/*",
        handler: async (req, reply) => {
          const url = authenticationRequestUrl(req);
          if (!url) return reply.code(400).send({ error: "Invalid request authority." });
          const authPath = new URL(url).pathname.slice("/api/auth".length);
          if (!betterAuthProxyRouteAllowed(authMode, req.method, authPath)) {
            return reply.code(404).send({ error: "Not found." });
          }
          const requestHeaders = toWebHeaders(req.headers);
          if (requestHeaders.has("cookie") || requestHeaders.has("authorization")) {
            req.authenticationUserId = await resolveAuthenticationUserId(auth, requestHeaders, req, logOn);
          }
          const response = await auth.handler(
            new Request(url, {
              method: req.method,
              headers: requestHeaders,
              body: req.body === undefined || req.body === null ? undefined : JSON.stringify(req.body),
            }),
          );
          reply.status(response.status);
          response.headers.forEach((value, key) => {
            if (key === "set-cookie" || key === "content-length" || key === "transfer-encoding") return;
            reply.header(key, value);
          });
          const cookies = response.headers.getSetCookie();
          if (cookies.length > 0) reply.header("set-cookie", cookies);
          if (req.authenticationUserId === null && response.status < 400 && cookies.length > 0) {
            req.authenticationUserId = await resolveAuthenticationUserId(
              auth,
              withResponseCookies(requestHeaders, cookies),
              req,
              logOn,
            );
          }
          return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
        },
      });
    }

    // The login → account list that drives the AccountPicker (P1.13). OFF mode is trusted-local:
    // EVERY account is accessible, so return all summaries with NO membership gate — branch on
    // authMode === 'off' BEFORE touching membership (the OFF guarantee). Auth-on returns ONLY the
    // caller's memberships through AccountAdminPort. Returns AccountSummary[] = [{ id, name, role }].
    app.get("/api/accounts", async (req) => {
      if (authMode === "off") {
        // No membership in off mode: every account is visible. Map to the same AccountSummary shape
        // The account port maps to ({ id, name, role }) so the auth-on / auth-off shapes are identical on
        // the wire. The role is 'owner' — the trusted-local full-access sentinel: OFF is byte-identical
        // to today's no-login deploy, so the client's pure `can('owner', …)` keeps OFF fully editable
        // (and a Viewer read-only mode is reachable ONLY auth-on, where a real membership role exists).
        const accounts = listAccountSummaries(db);
        return accounts.map((account) => ({
          id: account.id,
          name: account.name,
          role: "owner" as const,
        }));
      }
      const memberships = await accountAdminPort.listWorkspacesForPrincipal({
        principalId: req.accountActor!.principalId,
      });
      return memberships.map((membership) => ({
        id: membership.workspaceId,
        name: membership.workspaceName,
        role: membership.role,
      }));
    });

    // Whole-state read backs the client's PersistenceAdapter.loadAll(). Only WRITES are entity-level;
    // reads stay whole-tree so hydration is one round-trip.
    //
    // P1.4: when `?accountId=` is PRESENT, return that account's scoped slice via the TenantStore
    // (OFF mode: no gate — trusted-local; auth-on: a thin membership-existence guard — a null role
    // null ⇒ 403, so auth-on can't cross-tenant-read; the richer per-action can() gate is P1.5).
    app.get("/api/state", (req, reply) => {
      const { accountId } = req.query as { accountId?: string };
      if (accountId !== undefined) {
        if (typeof accountId !== "string" || accountId.length === 0) {
          return reply.code(400).send({ error: "accountId must be a non-empty string." });
        }
        // Refuse a cross-tenant read before any data leaves the DB. The authorize seam is the
        // single source of truth: OFF mode short-circuits to allow-all (trusted-local), auth-on
        // requires membership (read = any member, via can()) and 403s a non-member.
        if (!authorize(req, reply, accountId, "read")) return;
        // P1.6 field-level redaction: the time-off `note` is owner/admin-only. Decide visibility from
        // the caller's role and redact it SERVER-SIDE so it never serializes for an Editor/Viewer.
        // OFF mode = trusted-local ⇒ include. Auth-on: owner/admin include, editor/viewer omit.
        // The port role is non-null here (authorize('read') already proved membership); the `role !==
        // null` guard is belt-and-braces / fail-closed (an unexpected null omits the note, never leaks).
        const role = authMode === "off" ? null : accountAdminPort.roleForPrincipalInWorkspace(req.user!.id, accountId);
        // Derive the export/read include flags from the SAME GATED_FIELD_POLICIES predicates that
        // drive the write-pin and read-echo, so the three can never disagree. OFF is trusted-local ⇒
        // include everything; otherwise each gated field is included iff the role may see it.
        const vis = authMode === "off" ? ALL_FIELDS_VISIBLE : visibilityForRole(role);
        // P2.5a admin "Archived & deleted" read. `?includeInactive=1` asks for the FULL slice
        // (archived + soft-deleted rows retained), which is privileged: it is gated at the SAME tier as
        // purge (admin+ with a fresh session) — the lifecycle-management tier — so an editor/viewer or
        // stale privileged session cannot pull tombstones. OFF mode is trusted-local ⇒ always allowed.
        // A refusal is explicit rather than silently falling back to the active-only read.
        //
        // P2.6 COMPLETE PER-TENANT EXPORT. This same admin/'purge'-gated `?includeInactive=1` read IS
        // the roadmap's "complete per-tenant backup": exactly ONE account's slice (the accountId guard
        // above), retaining archived + soft-deleted rows so nothing is silently dropped from the backup
        // — UNLIKE the client's active-only "Export JSON" (P2.4), which projects via activeOnly and so
        // omits tombstones. The server-control tables (account_members / invites / Better Auth user|
        // session|account) are STRUCTURALLY excluded: readSlice only ever reads `accounts` + the scoped
        // tables, never the control plane, so membership/invite secrets/PII can never ride the export.
        // The slice composition is locked by app.export.test.ts.
        const includeInactive = (req.query as { includeInactive?: string }).includeInactive;
        if (includeInactive !== undefined && includeInactive !== "1") {
          return reply.code(400).send({ error: "includeInactive must be the literal value 1 when present." });
        }
        const wantsInactive = includeInactive === "1";
        if (wantsInactive && !authorize(req, reply, accountId, "purge")) return;
        // P2.4: the NORMAL app read HIDES archived/soft-deleted resources/clients/projects — pass
        // includeInactive:false so readSlice drops them server-side (the same rule the client views
        // apply via useActiveScopedData). The P2.5a admin read passes true to retain them.
        return store.readSlice(accountId, {
          ...readSliceVisibility(vis),
          includeInactive: wantsInactive,
        });
      }
      // No ?accountId=. The auth-on cross-tenant whole-read is now CLOSED (P1.13 — the P1.4
      // carry-forward): a logged-in user must hydrate PER ACCOUNT via ?accountId= (the client picker
      // → GET /api/accounts → GET /api/state?accountId=). Returning the whole DB to any authed user
      // was a tenant-isolation leak; 400 it. OFF mode is trusted-local, so it RETAINS the whole read
      // (db-helpers, the OFF db-backed e2e, and the OFF app.accounts tests all rely on it). The client
      // adapter treats this 400 on the NO-ARG read as "hydrate empty, show the picker" (see
      // ServerSyncAdapter.loadAll), so a no-arg bootstrap in auth-on lands on the picker, not an error.
      if (authMode !== "off") {
        return reply.code(400).send({ error: "accountId is required." });
      }
      // OFF: trusted-local whole read RETAINED. (P1.6 note: this whole read does NOT redact the
      // time-off `note` — fine, OFF is trusted-local and includes it everywhere.)
      return loadState(db);
    });

    // "has this dataset ever been initialised" (persistent marker), NOT "is it currently
    // non-empty" — so a user who deletes all their data isn't re-seeded on the next load
    // (the bug was: an emptied dataset reported hasData:false and got the demo seed back).
    // This authenticated probe is deliberately not membership-gated: initialization is an
    // instance-level bootstrap sentinel, not tenant data, and reveals no account, identity or row
    // count. A membership-less principal therefore receives the same single boolean needed by the
    // startup adapter without gaining access to any scoped state.
    app.get("/api/meta", () => ({ hasData: isInitialized(db) }));

    // Constrained org-creation (P1.8): the ATOMIC "create a usable account" path, and — with auth
    // on — the ONLY account-create path: the generic vectors (POST /api/accounts, PUT-as-create,
    // batch PUT-as-create) now refuse auth-on creates with a 403 directing here (see
    // ACCOUNT_CREATE_CLOSED_MESSAGE; they stay open in OFF mode for the trusted-local client).
    // Unlike those bare row writes, /api/orgs ALSO mints the account's built-in Internal client and
    // makes the caller its Owner, in ONE transaction.
    //
    // AUTHORIZATION is evaluated by AccountAdminPort INSIDE the coordinator's transaction while
    // the application-wide provisioning lock is held. That closes the check/write race between two
    // concurrent first-company requests while keeping policy out of the coordinator itself. Two
    // separate conditions must pass:
    //
    //   (1) The single-company cap (WHETHER a new company may exist at all; see
    //       AppOptions.multiAccount). It is evaluated first so a denied caller sees the actionable
    //       cap message. OFF mode and the bootstrap token do not bypass it.
    //
    //   (2) WHO may create it once the cap permits. AccountAdminPort applies the same four arms that
    //       /api/auth/me mirrors for its advisory canCreateAccount flag. Allowed iff ANY of:
    //   (1) ZERO accounts exist — first-run bootstrap (anyone may create the very first org; this
    //       is also the only case GATE 0 lets through by default, so it's the common path).
    //   (2) OFF mode (trusted-local) — mirrors the authorize() OFF no-op; req.user is DEMO_USER.
    //   (3) auth-on: the caller is an ACTIVE Owner/Admin of SOME existing account (can(role,
    //       'manageMembers') = admin-tier) with fresh administrative assurance — an existing
    //       operator may provision more orgs after the same step-up required for other Owner grants.
    //   (4) a valid bootstrap token in the `x-capacitylens-bootstrap-token` header (opts.bootstrapToken,
    //       env CAPACITYLENS_BOOTSTRAP_TOKEN, OFF by default — disabled when unset/empty).
    // Otherwise 403 — the acceptance criterion: a STRANGER cannot create an org once any account
    // exists, absent a bootstrap token. The gate runs in auth-on AND off; in off mode (1)/(2) already
    // allow, so the token/membership branches are moot there.
    app.post("/api/orgs", async (req, reply) => {
      // Build a VALID account row from the body (name required; colour repaired; junk schedulingMode
      // dropped) via the SAME sanitize/validate the generic account create uses — so /api/orgs can't
      // persist a row the generic path would reject. The id is generated server-side when the body
      // omits one (the org-create caller need not mint it, unlike the entity sync path); a provided id
      // is accepted and validated like any other write.
      try {
        if (
          authMode === "sso" &&
          (auth?.strictProvider?.id === undefined || req.authenticationProviderId !== auth.strictProvider.id)
        ) {
          return accountFail(
            reply,
            new AccountContractError({
              code: "FORBIDDEN",
              message: "Sign in with the required SSO provider before creating a company.",
              retryable: false,
            }),
          );
        }
        const command = accountCommand(req);
        const bootstrapAuthorized = secretTokenMatches(
          opts.bootstrapToken,
          req.headers["x-capacitylens-bootstrap-token"],
        );
        const now = new Date().toISOString();
        const id =
          typeof (req.body as { id?: unknown })?.id === "string" && (req.body as { id: string }).id.trim() !== ""
            ? (req.body as { id: string }).id
            : generatedWorkspaceId(command.commandId);
        const accountRow = sanitizeWrite("accounts", {
          ...(req.body as Record<string, unknown>),
          id,
          createdAt: now,
          updatedAt: now,
        });
        // Server timestamps are result data, not caller intent. Excluding them from the command
        // digest lets an identical retry replay the first committed row after wall time advances.
        const canonicalAccountRow = canonicalAccountProductPayload(accountRow);
        const provisioned = await accountFlows.provisionWorkspace({
          actor: req.accountActor!,
          workspaceId: id,
          joinedAt: now,
          command,
          multiWorkspace: opts.multiAccount === true,
          bootstrapAuthorized,
          canonicalProductPayload: canonicalAccountRow,
          provisionProductData: () => {
            // Finding 9: accounts validation is name-only (validate.ts), so it needs no cross-table
            // data — a full-DB loadState here was pure waste. Scope to this account's (empty) slice.
            validateWrite(emptyAppData(), "accounts", accountRow);
            insertRow(db, "accounts", accountRow);
            insertRow(db, "clients", buildInternalClient(id, now) as unknown as Record<string, unknown>);
            enqueueAudit(db, {
              ts: String(accountRow.createdAt),
              userId: req.user!.id,
              accountId: id,
              action: "create",
              entity: "accounts",
              id,
              changedFields: acceptedFieldNames("accounts", accountRow),
            });
            return accountRow;
          },
        });
        if (!provisioned.replayed) {
          drainProductAudit(reply);
        }
        return reply.code(201).send(provisioned.product);
      } catch (err) {
        return err instanceof AccountContractError ? accountFail(reply, err) : sendFail(reply, err);
      }
    });

    registerAccountRoutes(app, {
      authMode,
      authenticationConfigured: auth !== null,
      requiredSsoProviderId: authMode === "sso" ? (auth?.strictProvider?.id ?? null) : null,
      administration: accountAdminPort,
      identity: identityPort,
      flows: accountFlows,
      memberSignInTracking: {
        snapshot: (workspaceId) => memberSignInTrackingSnapshot(db, workspaceId),
        set: (workspaceId, actorPrincipalId, enabled) =>
          setMemberSignInTracking(db, workspaceId, actorPrincipalId, enabled),
      },
      authorize,
      command: accountCommand,
      audit,
      fail: accountFail,
    });

    registerLifecycleRoutes(app, {
      store,
      authorize,
      commit: (reply, record, mutation) => {
        commitProductAudit(reply, record, mutation);
      },
      fail: sendFail,
      redact: (req, entity, row, accountId) => redactWriteEcho(entity, row, fieldVisibilityFor(req, entity, accountId)),
    });

    // The `accounts` row write surface. These are STATIC paths, which find-my-way matches ahead of
    // the parametric /api/:entity routes below — so an account write can never reach the generic
    // handlers and pick up SCOPED-entity semantics (isScopedTable/ownsRow are both no-ops for a
    // table with no accountId column). Registering them here also deletes the ~25 hand-replicated
    // `entity === "accounts"` branches the generic routes carried, one per verb per rule.
    registerAccountEntityRoutes(app, {
      db,
      store,
      authMode,
      multiAccount: opts.multiAccount === true,
      optimisticConcurrency: opts.optimisticConcurrency !== false,
      flows: accountFlows,
      authorize,
      command: accountCommand,
      replayCommand: replayAccountCommand,
      fieldVisibility: fieldVisibilityFor,
      redact: redactWriteEcho,
      commitProductAudit,
      drainProductAudit,
      ownsRow,
      isStaleWrite,
      enqueueAudit: (record) => enqueueAudit(db, record),
      fail: sendFail,
      accountFail,
    });

    // Generic scoped-entity creation. `accounts` is served by the dedicated routes above.
    app.post("/api/:entity", (req, reply) => {
      const { entity } = req.params as { entity: string };
      if (!isGenericEntity(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` });
      // Shared body-shape + builtin-Internal guard (Finding 7 funnel). A missing/non-object body
      // would otherwise null-deref below (accountId! / sanitizeWrite's assertIdPresent) BEFORE the
      // try block could classify it — a misclassified 500. checkEntityWriteBody rejects it with the
      // same shape /api/batch and /api/import use.
      const scoped = isScopedTable(entity);
      const bodyCheck = checkEntityWriteBody("create", entity, req.body, undefined, scoped);
      if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
      const requestRow = req.body as Record<string, unknown>;
      const builtinCheck = builtinInternalWriteGuard("create", entity, undefined, requestRow);
      if (builtinCheck) return reply.code(builtinCheck.status).send({ error: builtinCheck.error });
      // P1.5 write gate (scoped tables only).
      if (scoped) {
        if (!authorize(req, reply, requestRow.accountId as string, "write")) return;
      }
      try {
        // P1.6: a note-blind writer CREATING time off gets its `note` stripped (nothing stored
        // to preserve; they could never read back a note they authored) — see sanitizeWrite.
        const vis = fieldVisibilityFor(req, entity, requestRow.accountId);
        // Finding 7/9 funnel: sanitize + stamp + ACCOUNT-SCOPED read + validate in one place (was an
        // inline sanitize/stamp + a full-DB loadState here).
        const { row } = prepareScopedWrite({
          store,
          entity,
          body: requestRow,
          existing: undefined,
          vis,
          verb: "create",
        });
        const auditRecord = buildAuditRecord(
          req.user!.id,
          (row.accountId as string | undefined) ?? (row.id as string),
          "create",
          entity,
          row.id as string,
          appliedRequestedFieldNames(entity, requestRow, undefined, row),
        );
        commitProductAudit(reply, auditRecord, () => {
          insertRow(db, entity, row);
        });
        return reply.code(201).send(row);
      } catch (err) {
        return sendFail(reply, err);
      }
    });

    // Idempotent upsert by id — the verb the client sync adapter uses for every
    // create AND update, so a replayed batch (after a partial failure) is safe. The
    // body's id must match the URL id.
    app.put("/api/:entity/:id", (req, reply) => {
      const { entity, id } = req.params as { entity: string; id: string };
      if (!isGenericEntity(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` });
      const scoped = isScopedTable(entity);
      const bodyCheck = checkEntityWriteBody("replace", entity, req.body, id, scoped);
      if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
      const body = req.body as Record<string, unknown>;
      // P1.5 write gate (scoped tables): membership + write tier for the body's accountId. The
      // ownsRow immutability guard below still runs — authorize gates WHO may write, ownsRow keeps
      // accountId immutable.
      if (scoped && !authorize(req, reply, body.accountId as string, "write")) return;
      try {
        const existing = getRow(db, entity, id);
        const builtinCheck = builtinInternalWriteGuard("replace", entity, existing, body);
        if (builtinCheck) return reply.code(builtinCheck.status).send({ error: builtinCheck.error });
        // Ordinary Editors may manage clients, but changing the server-owned Internal singleton's
        // identity also rewrites every referencing project. Preserve the documented legacy-id
        // adoption path while requiring a fresh Admin/Owner session for that privileged migration.
        if (
          entity === "clients" &&
          body.builtin === true &&
          existing?.builtin !== true &&
          !authorize(req, reply, body.accountId as string, "manageInternalClient")
        )
          return;
        // accountId is immutable: a write must not move an EXISTING row to another account
        // (see ownsRow). The web store enforces this via findOwned; without the same guard a
        // crafted request could re-home a row and orphan its children across the tenant boundary.
        if (!ownsRow(existing, body.accountId)) {
          return reply.code(404).send({ error: "Not found" });
        }
        // P1.6: the note-visibility fact for this writer — used to PIN the time-off `note` on the
        // write (their round-tripped row was redacted, so a bare upsert would NULL a note they
        // never saw — see sanitizeWrite) AND to redact the note from everything echoed back below,
        // the 409 conflict payload included.
        const vis = fieldVisibilityFor(req, entity, body.accountId);
        // Optimistic concurrency (opt-in): refuse to overwrite a strictly newer row — the
        // predicate is isStaleWrite, SHARED with the batch loop so the two paths can't drift.
        // The 409's `current` payload is a READ of the stored row, so it gets the same note
        // redaction as the write echo — the conflict path must not hand a note-blind writer
        // the redacted field.
        if (opts.optimisticConcurrency !== false && isStaleWrite(existing, body)) {
          return reply.code(409).send({
            error: "The record was modified more recently on the server.",
            current: redactWriteEcho(entity, existing, vis),
          });
        }
        // Finding 7/9 funnel: sanitize + stamp + ACCOUNT-SCOPED read + validate in one place (was an
        // inline sanitize/stamp + a full-DB loadState here). A generated-builtin replacement defers
        // its validation (see prepareScopedWrite); every other write is validated there.
        const { row, generatedReplacement, scopedState } = prepareScopedWrite({
          store,
          entity,
          body,
          existing,
          vis,
          verb: "replace",
        });
        const auditRecord = buildAuditRecord(
          req.user!.id,
          (body.accountId as string | undefined) ?? id,
          existing ? "update" : "create",
          entity,
          id,
          appliedRequestedFieldNames(entity, body, existing, row),
        );
        let rewrittenAllocations: RewrittenAllocationRevision[] = [];
        commitProductAudit(reply, auditRecord, () => {
          if (generatedReplacement) {
            replaceGeneratedBuiltin(db, scopedState, generatedReplacement, row);
          } else if (entity === "activities") {
            rewrittenAllocations = writeActivityRow(db, undefined, row, existing);
          } else {
            // Validation already ran in the funnel above.
            upsertRow(db, entity, row);
          }
        });
        // A write response is a read: apply the same note/private-name projections as /api/state.
        const echo = redactWriteEcho(entity, row, vis);
        // Activity writes add rewritten allocation revisions beside the ordinary activity echo so
        // direct-route callers can reconcile the same server-owned cascade as batch callers.
        return reply.code(200).send(entity === "activities" ? { ...echo, rewrittenAllocations } : echo);
      } catch (err) {
        return sendFail(reply, err);
      }
    });

    // True partial patch: merge the body over the stored row, then sanitize + validate
    // the MERGED entity before writing. (A blind column-wise update would null every
    // field the body omits.) 404 when the row doesn't exist.
    app.patch("/api/:entity/:id", (req, reply) => {
      const { entity, id } = req.params as { entity: string; id: string };
      if (!isGenericEntity(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` });
      // Shared body-shape check (Finding 7 funnel). A missing/non-object body would otherwise
      // null-deref inside sanitizeWrite's merge, a misclassified 500. For PATCH accountId is
      // OPTIONAL — only a PRESENT non-string is rejected.
      const scoped = isScopedTable(entity);
      const bodyCheck = checkEntityWriteBody("patch", entity, req.body, id, scoped);
      if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
      try {
        const existing = getRow(db, entity, id);
        if (!existing) return reply.code(404).send({ error: "Not found" });
        // A scoped PATCH has no required account assertion in its partial body. Authorize against
        // the stored owner, but conceal non-membership as the same 404 used for an absent id. Run
        // row-specific guards only after that boundary so a foreign built-in row is not an oracle.
        if (
          scoped &&
          !authorize(req, reply, existing.accountId as string, "write", {
            concealNonMembership: true,
          })
        )
          return;
        const builtinCheck = builtinInternalWriteGuard("patch", entity, existing, req.body as Record<string, unknown>);
        if (builtinCheck) return reply.code(builtinCheck.status).send({ error: builtinCheck.error });
        // P1.6 note pin (see sanitizeWrite): the merge already carries the STORED note (a note-blind
        // caller's PATCH body can't include one they never received), but the pin also stops a
        // crafted note change/clear riding a patch. accountId for the role lookup = the body's
        // override if present (then refused by ownsRow below), else the stored row's.
        const vis = fieldVisibilityFor(
          req,
          entity,
          (req.body as { accountId?: unknown }).accountId ?? existing.accountId,
        );
        const merged = sanitizeWrite(
          entity,
          { ...existing, ...(req.body as Record<string, unknown>), id },
          existing,
          vis,
        );
        // accountId is immutable — a patch must not re-home the row to another company (ownsRow).
        if (!ownsRow(existing, merged.accountId)) {
          return reply.code(404).send({ error: "Not found" });
        }
        if (
          opts.optimisticConcurrency !== false &&
          isStaleWrite(existing, req.body as Record<string, unknown>, false)
        ) {
          return reply.code(409).send({
            error: "The record was modified more recently on the server.",
            current: redactWriteEcho(entity, existing, vis),
          });
        }
        const stamped = stampServerRevision(merged, existing);
        // PATCH already authorized the stored owner and proved accountId immutable above. SQLite's
        // validation lookup resolves only the row/FK/dependent coordinates this write needs; custom
        // stores retain the complete-slice fallback. Client replacement still needs the full client
        // set for its singleton/reparent rule.
        const scopeId = String(merged.accountId);
        const lookup = store.validationLookup?.();
        const validationState =
          entity === "clients" || lookup === undefined ? store.readFullSlice(scopeId) : emptyAppData();
        validateWrite(validationState, entity, stamped, existing, lookup);
        // Record only requested keys whose sanitized, pinned result actually differs from storage.
        let rewrittenAllocations: RewrittenAllocationRevision[] = [];
        commitProductAudit(
          reply,
          buildAuditRecord(
            req.user!.id,
            (merged.accountId as string | undefined) ?? id,
            "patch",
            entity,
            id,
            appliedRequestedFieldNames(entity, req.body, existing, stamped),
          ),
          () => {
            if (entity === "activities") {
              rewrittenAllocations = writeActivityRow(db, undefined, stamped, existing);
            } else {
              upsertRow(db, entity, stamped);
            }
          },
        );
        // The merge carries stored protected fields into `merged`; apply the normal read projection.
        const echo = redactWriteEcho(entity, stamped, vis);
        // See PUT above: activity responses expose additive cascade revisions to direct callers.
        return reply.code(200).send(entity === "activities" ? { ...echo, rewrittenAllocations } : echo);
      } catch (err) {
        return sendFail(reply, err);
      }
    });

    app.delete("/api/:entity/:id", (req, reply) => {
      const { entity, id } = req.params as { entity: string; id: string };
      if (!isGenericEntity(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` });
      if (isLifecycleEntity(entity)) {
        return reply.code(400).send({
          error: "Use the dedicated lifecycle endpoints for this entity.",
        });
      }
      // Scope a scoped-table delete to its owning account — the server analog of the
      // client's MANDATORY findOwned guard. A scoped delete MUST assert an owning account:
      // omitting it can't prove ownership, so we refuse with 400 (rather than deleting by id,
      // which was a tenant-guard bypass). A wrong owner is 404. (A company hard-delete is a TENANT
      // ERASURE, not a bare row delete — it has its own DELETE /api/accounts/:id route.)
      const { accountId } = req.query as { accountId?: string };
      try {
        if (!isScopedTable(entity)) {
          return reply.code(403).send({
            error: "No deletion policy is defined for this entity.",
          });
        }
        if (accountId === undefined) {
          return reply.code(400).send({
            error: "accountId is required to delete a scoped record.",
          });
        }
        // Resolve authority from the caller-asserted tenant before reading the candidate row. A
        // non-member therefore receives the same 403 for absent and foreign ids; an authorized
        // member receives the same 404 for either. OFF mode retains its historical idempotent 204.
        if (!authorize(req, reply, accountId, "write")) return;
        const existing = getRow(db, entity, id);
        if (!ownsRow(existing, accountId) || (!existing && authMode !== "off")) {
          return reply.code(404).send({ error: "Not found" });
        }
        if (existing) {
          commitProductAudit(reply, buildAuditRecord(req.user!.id, accountId, "delete", entity, id, []), () =>
            deleteRow(db, entity, id),
          );
        }
        return reply.code(204).send();
      } catch (err) {
        return sendFail(reply, err);
      }
    });

    // Transactional batch write — the verb the client sync adapter uses for every save.
    // Body: { ops: BatchOp[] }, already ordered (upserts parent-first, then deletes
    // child-first; see the client's syncOps.diffOps). The whole list is applied in ONE
    // transaction: all-or-nothing. This is what makes a reparent+delete safe — the
    // re-binding upsert commits before the old parent's DELETE cascades, so the cascade
    // finds nothing to take — and guarantees a mid-batch failure rolls back, leaving the
    // prior data intact. Each op reuses the SAME ownsRow / sanitizeWrite / validateWrite the
    // per-entity routes use; one request-scoped state projection is loaded inside the transaction
    // and advanced after each op, so a child validates against a parent a sibling op just upserted.
    app.post("/api/batch", async (req, reply) => {
      const body = req.body as { ops?: unknown };
      if (!body || !Array.isArray(body.ops)) {
        return reply.code(400).send({ error: "ops array is required" });
      }
      const ops = body.ops as BatchOp[];
      const rawSyncSession = req.headers["x-capacitylens-sync-session"];
      const rawSyncSequence = req.headers["x-capacitylens-sync-sequence"];
      let syncOrder: SyncOrder | null = null;
      if (rawSyncSession !== undefined || rawSyncSequence !== undefined) {
        const sequence =
          typeof rawSyncSequence === "string" && /^[1-9]\d{0,15}$/.test(rawSyncSequence)
            ? Number(rawSyncSequence)
            : Number.NaN;
        if (!isBrowserSyncSessionId(rawSyncSession) || !Number.isSafeInteger(sequence)) {
          return reply.code(400).send({ error: "Invalid browser sync ordering headers." });
        }
        syncOrder = { sessionId: rawSyncSession, sequence };
      }
      // Ordered-op updatedAt guard shared by the PUT/DELETE/ARCHIVE branches of the pre-scan below —
      // a no-op unless this request carries sync ordering headers (closes over syncOrder above).
      const requireOrderedUpdatedAt = (value: unknown, verbLabel: string): { status: number; error: string } | null =>
        syncOrder && typeof value !== "string"
          ? { status: 400, error: `An ordered ${verbLabel} op needs a string updatedAt revision.` }
          : null;
      // MAX_BATCH_OPS (see its doc comment) bounds the per-operation multiplier; the initial
      // projection read still scales once with each affected account's slice.
      // Rejected before the pre-scan and transaction, so an over-cap batch does no per-op work.
      if (ops.length > MAX_BATCH_OPS) {
        return reply.code(400).send({
          error: `A batch may contain at most ${MAX_BATCH_OPS} operations.`,
        });
      }
      for (const rawOp of ops as unknown[]) {
        if (!rawOp || typeof rawOp !== "object" || Array.isArray(rawOp)) {
          return reply.code(400).send({ error: "Each op must be an object." });
        }
        const op = rawOp as Partial<BatchOp>;
        if (op.method !== "PUT" && op.method !== "DELETE" && op.method !== "ARCHIVE") {
          return reply.code(400).send({ error: `Unknown op method: ${String(op.method)}` });
        }
        if (typeof op.table !== "string" || !isKnownTable(op.table) || typeof op.id !== "string") {
          return reply.code(400).send({ error: "Each op needs a known table and string id." });
        }
        if (op.method === "PUT") {
          const rejection = checkEntityWriteBody("replace", op.table, op.row, op.id, isScopedTable(op.table));
          if (rejection) return reply.code(rejection.status).send({ error: rejection.error });
          const row = op.row as Record<string, unknown>;
          const orderedRejection = requireOrderedUpdatedAt(row.updatedAt, "PUT");
          if (orderedRejection) return reply.code(orderedRejection.status).send({ error: orderedRejection.error });
        } else if (op.method === "DELETE") {
          if (isLifecycleEntity(op.table)) {
            return reply.code(400).send({
              error: "Use the dedicated lifecycle endpoints for lifecycle entities.",
            });
          }
          if (op.table === "accounts") {
            return reply.code(400).send({ error: "Use the dedicated company deletion endpoint." });
          }
          if (isScopedTable(op.table) && typeof op.accountId !== "string") {
            return reply.code(400).send({ error: "A scoped DELETE op needs a string accountId." });
          }
          const orderedRejection = requireOrderedUpdatedAt(op.updatedAt, "DELETE");
          if (orderedRejection) return reply.code(orderedRejection.status).send({ error: orderedRejection.error });
        } else {
          if (!isLifecycleEntity(op.table)) {
            return reply.code(400).send({ error: "ARCHIVE is supported only for lifecycle entities." });
          }
          if (typeof op.accountId !== "string") {
            return reply.code(400).send({ error: "An ARCHIVE op needs a string accountId." });
          }
          const orderedRejection = requireOrderedUpdatedAt(op.updatedAt, "ARCHIVE");
          if (orderedRejection) return reply.code(orderedRejection.status).send({ error: orderedRejection.error });
        }
      }
      if (ops.length === 0 && syncOrder === null) {
        return reply.code(200).send({
          ok: true,
          applied: 0,
          changed: 0,
          revisions: [],
          auditWarning: false,
        });
      }
      // Shape validation above established every source. This set bounds validation reads to the
      // account slices the request can actually touch; an ordered empty batch deliberately has no
      // slice but still reaches the lightweight sync-sequence transaction below.
      const affectedAccountIds = new Set<string>();
      for (const op of ops) {
        if (op.table === "accounts") {
          affectedAccountIds.add(op.id);
        } else if (isScopedTable(op.table as keyof typeof TABLES)) {
          affectedAccountIds.add(op.method === "PUT" ? (op.row!.accountId as string) : op.accountId!);
        }
      }
      // P1.5 write gate — PRE-SCAN before the tx opens so the batch is rejected WHOLE (one 403, no
      // partial write) if ANY op targets an account the caller may not write. A scoped PUT derives
      // its accountId from op.row.accountId, a scoped DELETE from op.accountId. The unscoped
      // Account deletion is accepted only by the dedicated erasure route and was rejected during
      // shape validation above, so the generic sync path can never turn a bad diff into tenant
      // destruction. An accounts
      // PUT that is an UPDATE gates 'write'; an accounts PUT that is a CREATE is refused outright
      // when auth is on (→ POST /api/orgs, see ACCOUNT_CREATE_CLOSED_MESSAGE) and stays open ONLY
      // in OFF mode, where the single-company cap (accountCreateCapped) can still deny it — either
      // refusal fails the whole batch, see below. In OFF mode authorize
      // short-circuits true, so the whole loop is a no-op pass for authz; the cap check is NOT part of that no-op — it runs
      // regardless of authMode.
      // Evaluate the single-company cap against the batch's PROJECTED state, not once per op
      // against the same pre-transaction snapshot. Two distinct account creates in an empty DB
      // must be rejected together rather than both passing and committing.
      const hasAccountOperations = ops.some((op) => op.table === "accounts");
      const accountProjection = hasAccountOperations
        ? projectBatchAccounts(db, ops)
        : { count: 0, createsFinalAccount: false };
      // Authenticated account creation is closed on this generic sync route (the loop below
      // returns ACCOUNT_CREATE_CLOSED_MESSAGE). In trusted-local mode, project the *whole* batch
      // before starting the transaction so two creates cannot both pass against the same empty DB.
      if (
        authMode === "off" &&
        accountProjection.createsFinalAccount &&
        !opts.multiAccount &&
        accountProjection.count > 1
      ) {
        return reply.code(403).send({ error: SINGLE_COMPANY_CAP_MESSAGE });
      }

      const authorizeBatchOperations = (): boolean => {
        // This function is invoked once before waiting for workspace locks and again after lock
        // acquisition. Keep the cache local so those remain independent authorization snapshots,
        // while repeated operations for the same account/action do not repeat the identical
        // membership query within either snapshot. Only successful checks are cached; a denial
        // sends its response and ends the pass immediately.
        const authorizedActions = new Map<string, Set<Action>>();
        const authorizeOnce = (accountId: string, action: Action): boolean => {
          const actions = authorizedActions.get(accountId);
          if (actions?.has(action)) return true;
          if (!authorize(req, reply, accountId, action)) return false;
          if (actions) actions.add(action);
          else authorizedActions.set(accountId, new Set([action]));
          return true;
        };

        for (const op of ops) {
          if (op?.table === "accounts" && op.method === "PUT") {
            const existingAccount = getRow(db, "accounts", op.id);
            if (existingAccount) {
              if (!authorizeOnce(op.id, "write")) return false;
            } else if (authMode !== "off") {
              reply.code(403).send({ error: ACCOUNT_CREATE_CLOSED_MESSAGE });
              return false;
            }
            // OFF-mode creates are checked against the projected final set and rechecked by the
            // provisioning policy inside the transaction.
            continue;
          }
          if (!isScopedTable(op.table)) {
            reply.code(403).send({
              error: "No batch-write policy is defined for this entity.",
            });
            return false;
          }
          const accountId =
            op.method === "PUT" ? (op.row as { accountId?: string } | undefined)?.accountId : op.accountId;
          const action: Action =
            op.method === "PUT" &&
            op.table === "clients" &&
            (op.row as { builtin?: unknown } | undefined)?.builtin === true
              ? "manageInternalClient"
              : "write";
          if (!authorizeOnce(accountId as string, action)) return false;
        }
        return true;
      };
      if (!authorizeBatchOperations()) return;
      // Field visibility, memoized PER REQUEST: fieldVisibilityFor pays an account-port membership
      // query for every timeOff/client/project row, and a batch may carry up to MAX_BATCH_OPS of them
      // — each op would otherwise re-run the identical lookup inside the write tx. Memoizing by
      // accountId is exact, not approximate: the caller (req.user) is fixed for the request, and
      // their role cannot change mid-transaction (tx() serializes on the single SQLite connection
      // membership writes also go through, so no interleaved role edit can land while the batch
      // runs). Unaffected tables short-circuit to the frozen ALL_FIELDS_VISIBLE constant — no
      // lookup, no allocation — so only distinct protected-field accountIds
      // (in practice: one) ever populate the cache.
      const fieldVisCache = new Map<string, SanitizeWriteOptions>();
      const fieldVisFor = (table: string, accountId: unknown): SanitizeWriteOptions => {
        if (!tableHasGatedFields(table) || typeof accountId !== "string") {
          return fieldVisibilityFor(req, table, accountId); // no-lookup short-circuits; nothing to cache
        }
        const cached = fieldVisCache.get(accountId);
        if (cached) return cached;
        const vis = fieldVisibilityFor(req, table, accountId);
        fieldVisCache.set(accountId, vis);
        return vis;
      };
      const revisions: Array<{
        table: string;
        id: string;
        createdAt: string;
        updatedAt: string;
        rewrite?: true;
      }> = [];
      const lifecycleArchives: Array<{ table: string; id: string; archived: boolean }> = [];
      let supersededSyncBatch = false;
      // Assigned inside the lock/tx closure below, but read at response shaping outside it — declared
      // here (like revisions/lifecycleArchives above) so it stays in scope at both points. `changed`
      // is derived from this at response time rather than hand-counted, so a null-out site can never
      // drift from what's actually reported.
      let auditRecords: Array<AuditRecord | null> = [];
      try {
        await accountFlows.withWorkspaceErasureLocks(
          [],
          () => {
            // Lock acquisition may yield behind another membership/ownership mutation. Re-evaluate
            // every permission after the wait and immediately before the synchronous transaction so
            // the pre-scan can never become stale authorization for a destructive or cross-tenant op.
            if (!authorizeBatchOperations()) throw new BatchAuthorizationResponseSent();
            // Lock acquisition may also have waited behind workspace provisioning. Classify against
            // the now-current database and project each preceding op so the audit verb describes the
            // same state the immediately following synchronous transaction will observe.
            const projectedRows = new Map<string, boolean>();
            const auditActions = ops.map((op): "create" | "update" | "delete" | "archive" | null => {
              const key = `${op.table}\0${op.id}`;
              const existed = projectedRows.has(key) ? projectedRows.get(key)! : Boolean(getRow(db, op.table, op.id));
              if (op.method === "PUT") {
                projectedRows.set(key, true);
                return existed ? "update" : "create";
              }
              if (op.method === "ARCHIVE") {
                projectedRows.set(key, existed);
                return existed ? "archive" : null;
              }
              projectedRows.set(key, false);
              return existed ? "delete" : null;
            });
            const auditTs = new Date().toISOString();
            auditRecords = ops.map((op, opIndex): AuditRecord | null => {
              const action = auditActions[opIndex];
              if (action === null) return null;
              return op.method === "PUT"
                ? {
                    ts: auditTs,
                    userId: req.user!.id,
                    accountId: (op.row as { accountId?: string } | undefined)?.accountId ?? op.id,
                    action,
                    entity: op.table,
                    id: op.id,
                    changedFields: acceptedFieldNames(op.table, op.row),
                  }
                : op.method === "ARCHIVE"
                  ? {
                      ts: auditTs,
                      userId: req.user!.id,
                      accountId: op.accountId!,
                      action: "archive",
                      entity: op.table,
                      id: op.id,
                      changedFields: ["archivedAt"],
                    }
                  : {
                      ts: auditTs,
                      userId: req.user!.id,
                      accountId: op.accountId ?? op.id,
                      action: "delete",
                      entity: op.table,
                      id: op.id,
                      changedFields: [],
                    };
            });
            return tx(
              db,
              () => {
                if (syncOrder && isSupersededSyncBatch(db, syncOrder)) {
                  supersededSyncBatch = true;
                  return;
                }
                // Read every relationship table, but only for accounts this request targets. `state` is
                // then advanced in lockstep with each write (upsert/cascade helpers) so op N validates
                // against exactly the state ops 1..N-1 produced without scanning unrelated tenants.
                const state = emptyAppData();
                for (const accountId of affectedAccountIds) {
                  appendAppDataSlice(state, store.readSlice(accountId, FULL_SLICE_READ));
                }
                const projection = new BatchStateProjection(state);
                const attributionClearedActivityIds = new Set<string>();
                // Recompute under the provisioning lock: the earlier cap projection may have waited
                // behind another top-level account mutation. A scalar COUNT is sufficient; validation's
                // account rows are already present in the affected slices above.
                const projectedWorkspaceCount = hasAccountOperations ? projectBatchAccounts(db, ops).count : 0;
                const mintedInternalIds = new Set<string>();
                for (const [opIndex, op] of ops.entries()) {
                  const { method, table, id } = op;
                  // Shape, method, known-table and id validation completed before authorization and before
                  // opening this transaction. This loop owns only state-dependent validation and mutation.
                  if (method === "PUT") {
                    const row = op.row;
                    if (!row || typeof row !== "object" || (row as { id?: unknown }).id !== id) {
                      throw new ValidationError("Each PUT op needs a row whose id matches the op id.");
                    }
                    // accountId is immutable (ownsRow): a write must not re-home an existing row.
                    const existing = getRow(db, table, id);
                    // Built-in Internal guard (Finding 7 — ONE implementation). The batch's own minted-
                    // Internal exception accepts only the canonical duplicate a client emitted alongside
                    // the account create; malformed or re-homed bodies roll the whole batch back.
                    if (table === "clients" && existing?.builtin === true && mintedInternalIds.has(id)) {
                      if (!matchesMintedInternalClient(existing, row as Record<string, unknown>)) {
                        throw new ValidationError(
                          "The same-batch built-in Internal client must match the generated server row.",
                        );
                      }
                      revisions.push({
                        table,
                        id,
                        createdAt: existing.createdAt as string,
                        updatedAt: existing.updatedAt as string,
                      });
                      // This submitted operation is acknowledged for sync/revision purposes, but
                      // the preceding account create already minted the identical row. Do not
                      // report or audit a second state change that never happened.
                      if (auditRecords[opIndex]) {
                        auditRecords[opIndex] = null;
                      }
                      continue;
                    }
                    const builtinRejection = builtinInternalWriteGuard(
                      "replace",
                      table,
                      existing,
                      row as Record<string, unknown>,
                    );
                    if (builtinRejection) throw new ValidationError(builtinRejection.error);
                    if (!ownsRow(existing, (row as { accountId?: unknown }).accountId)) {
                      throw new AccountContractError({
                        code: "NOT_FOUND",
                        message: "Not found",
                        retryable: false,
                      });
                    }
                    const sanitizedRow = sanitizeWrite(
                      table,
                      row as Record<string, unknown>,
                      existing,
                      fieldVisFor(table, (row as { accountId?: unknown }).accountId),
                    );
                    // language/weekStartsOn/timezone are FROZEN after creation (P1.14). Match the
                    // direct routes' 409 so the sync client takes its authoritative-reload path
                    // instead of retrying the same state-dependent conflict indefinitely.
                    if (table === "accounts" && accountFieldsFrozen(existing, sanitizedRow)) {
                      throw new AccountContractError({
                        code: "CONFLICT",
                        message: ACCOUNT_FROZEN_FIELDS_MESSAGE,
                        retryable: false,
                      });
                    }
                    // Optimistic concurrency is default-on for generic writes and mandatory for an
                    // ordered browser batch. The stale-write refusal is isStaleWrite, the SAME predicate
                    // the direct PUT route runs, so the two paths can't drift. Thrown
                    // (not replied) because we are inside tx(): the throw aborts the transaction, so
                    // the WHOLE batch rolls back, and the catch below maps it to the direct route's
                    // 409 + { current } shape.
                    if (
                      (opts.optimisticConcurrency !== false || syncOrder !== null) &&
                      isStaleWrite(existing, row as Record<string, unknown>) &&
                      !(syncOrder && isSameSessionSuccessor(db, syncOrder, table, id, existing))
                    ) {
                      // The 409's `current` payload is a READ of the stored row: redact the time-off
                      // note for a note-blind writer, exactly like the write echo (P1.6) — the conflict
                      // path must not hand an editor the very field readSlice redacts.
                      throw new StaleWriteError(
                        redactWriteEcho(
                          table,
                          existing,
                          fieldVisFor(table, (row as { accountId?: unknown }).accountId),
                        ),
                      );
                    }
                    // P1.6: pin the time-off `note` for a note-blind writer — the batch is the client's
                    // REAL save path, so an editor's redacted round-trip lands here (see sanitizeWrite).
                    const clean = stampServerRevision(sanitizedRow, existing);
                    const auditRecord = auditRecords[opIndex];
                    if (auditRecord) {
                      auditRecord.changedFields = appliedRequestedFieldNames(table, row, existing, clean);
                    }
                    const generatedReplacement = generatedBuiltinReplacement(state, table, clean);
                    if (table === "accounts" && !existing) {
                      // Evaluate provisioning policy before inserting the account, against the final
                      // count of the whole atomic batch. The surrounding application-wide lock is shared
                      // with /api/orgs; any later storage failure rolls this membership write back.
                      accountFlows.provisionWorkspaceInExistingTransaction({
                        workspaceId: id,
                        principalId: req.accountActor!.principalId,
                        joinedAt: clean.createdAt as string,
                        multiWorkspace: opts.multiAccount === true,
                        projectedWorkspaceCount,
                      });
                    }
                    if (generatedReplacement) {
                      replaceGeneratedBuiltin(db, state, generatedReplacement, clean);
                      projection.replaceGeneratedBuiltin(generatedReplacement, clean);
                    } else {
                      validateWrite(state, table, clean, existing, projection);
                      if (table === "activities") {
                        writeActivityRow(db, projection, clean, existing, attributionClearedActivityIds);
                      } else {
                        upsertRow(db, table, clean);
                        projection.upsert(table as AppDataKey, clean);
                      }
                    }
                    if (table === "accounts" && !existing) {
                      const internalClient = buildInternalClient(id, clean.createdAt as string) as unknown as Record<
                        string,
                        unknown
                      >;
                      upsertRow(db, "clients", internalClient);
                      projection.upsert("clients", internalClient);
                      mintedInternalIds.add(internalClient.id as string);
                    }
                    revisions.push({
                      table,
                      id,
                      createdAt: clean.createdAt as string,
                      updatedAt: clean.updatedAt as string,
                    });
                  } else if (method === "ARCHIVE") {
                    if (!isLifecycleEntity(table)) {
                      throw new ValidationError("ARCHIVE is supported only for lifecycle entities.");
                    }
                    const existing = getRow(db, table, id);
                    if (!ownsRow(existing, op.accountId)) {
                      throw new AccountContractError({
                        code: "NOT_FOUND",
                        message: "Not found",
                        retryable: false,
                      });
                    }
                    if (!existing) {
                      lifecycleArchives.push({ table, id, archived: false });
                      continue;
                    }
                    if (table === "clients" && isBuiltinClient(existing as never)) {
                      throw new ValidationError("The built-in Internal client cannot be archived.");
                    }
                    if (
                      syncOrder &&
                      isStaleWrite(existing, { updatedAt: op.updatedAt }) &&
                      !isSameSessionSuccessor(db, syncOrder, table, id, existing)
                    ) {
                      throw new StaleWriteError(
                        redactWriteEcho(table, existing, fieldVisFor(table, op.accountId ?? id)),
                      );
                    }
                    if (existing.archivedAt != null || existing.deletedAt != null) {
                      if (auditRecords[opIndex]) {
                        auditRecords[opIndex] = null;
                      }
                      lifecycleArchives.push({ table, id, archived: existing.archivedAt != null });
                      continue;
                    }
                    const now = nextServerRevision(existing.updatedAt);
                    const archived = {
                      ...archive(existing as unknown as LifecycleRow, now),
                      updatedAt: now,
                    };
                    store.writeLifecycleRow(op.accountId!, table, archived);
                    projection.upsert(table as AppDataKey, archived as unknown as Record<string, unknown>);
                    lifecycleArchives.push({ table, id, archived: true });
                  } else if (method === "DELETE") {
                    if (table === "accounts") {
                      throw new ValidationError("Use the dedicated company deletion endpoint.");
                    }
                    const existing = getRow(db, table, id);
                    // Scoped deletes assert ownership (same rule as the DELETE route).
                    if (isScopedTable(table)) {
                      if (typeof op.accountId !== "string") {
                        throw new ValidationError("accountId is required to delete a scoped record.");
                      }
                      if (!ownsRow(existing, op.accountId)) {
                        throw new AccountContractError({
                          code: "NOT_FOUND",
                          message: "Not found",
                          retryable: false,
                        });
                      }
                    }
                    if (
                      syncOrder &&
                      isStaleWrite(existing, { updatedAt: op.updatedAt }) &&
                      !isSameSessionSuccessor(db, syncOrder, table, id, existing)
                    ) {
                      throw new StaleWriteError(
                        redactWriteEcho(table, existing, fieldVisFor(table, op.accountId ?? id)),
                      );
                    }
                    deleteRow(db, table, id);
                    projection.delete(table as AppDataKey, id);
                  } else {
                    throw new ValidationError(`Unknown op method: ${String(method)}`);
                  }
                }
                const rewrittenAllocations = clearAllocationAttributionForActivities(db, attributionClearedActivityIds);
                projection.clearAllocationAttribution(rewrittenAllocations);
                for (const revision of rewrittenAllocations) {
                  revisions.push({ table: "allocations", ...revision, rewrite: true });
                }
                for (const record of auditRecords) {
                  if (record) enqueueAudit(db, record);
                }
                if (syncOrder) {
                  recordAppliedSyncBatch(
                    db,
                    syncOrder,
                    ops.map((op) => ({
                      table: op.table,
                      id: op.id,
                      accountId:
                        op.table === "accounts"
                          ? op.id
                          : op.method === "PUT"
                            ? (op.row!.accountId as string)
                            : op.accountId!,
                      row: getRow(db, op.table, op.id),
                    })),
                  );
                }
              },
              "immediate",
            );
          },
          {
            // Serialize every top-level account mutation with /api/orgs. The batch re-evaluates its
            // projected final count inside this lock and transaction, so concurrent first-company
            // batches cannot both commit against the same empty snapshot.
            serializeWorkspaceProvisioning: hasAccountOperations,
          },
        );
        if (supersededSyncBatch) {
          return reply.code(200).send({
            ok: true,
            applied: ops.length,
            changed: 0,
            revisions: [],
            archives: [],
            superseded: true,
            auditWarning: false,
          });
        }
        const auditFailed = !drainProductAudit(reply);
        if (auditFailed) reply.header("x-capacitylens-audit-warning", "true");
        // `applied` is the atomic receipt count: every submitted op was accepted and processed, so
        // the sync client can require equality with ops.length. `changed` counts submitted mutations
        // and excludes idempotent deletes; revisions may additionally report implicit allocation
        // rewrites caused by an activity kind change.
        return reply.code(200).send({
          ok: true,
          applied: ops.length,
          changed: auditRecords.filter((record) => record !== null).length,
          revisions,
          archives: lifecycleArchives,
          auditWarning: auditFailed,
        });
      } catch (err) {
        if (err instanceof BatchAuthorizationResponseSent) return;
        // Stale-write conflict (optimistic concurrency): mirror the direct PUT route's 409 +
        // `current` payload. tx() has already rolled the WHOLE batch back by the time this runs
        // (all-or-nothing), so no op from the conflicted batch persisted — the client re-syncs
        // from `current`. Checked BEFORE sendFail, which would misclassify it as a 500.
        if (err instanceof StaleWriteError) {
          return reply.code(409).send({ error: err.message, current: err.current });
        }
        return err instanceof AccountContractError ? accountFail(reply, err) : sendFail(reply, err);
      }
    });

    // Bulk import into one account, reusing the SAME remap+validate+sanitize the store
    // runs (shared/domain/mutations.remapAndValidateImport). Body: { accountId, data }.
    // `data` may be a raw export ({schemaVersion,data} or bare AppData); parseData
    // applies the shape guard + MAX_IMPORT_RECORDS cap + migration.
    //
    // EXEMPT from the single-company cap: replaceAccountSlice only ever rewrites SCOPED tables
    // (accountId-carrying), never `accounts` itself — an import can only replace an EXISTING
    // account's data, never insert a new top-level accounts row. So there is no create vector here
    // for accountCreateCapped to gate.
    app.post("/api/import", async (req, reply) => {
      const body = req.body as { accountId?: string; data?: unknown };
      if (!body || typeof body.accountId !== "string") {
        return reply.code(400).send({ error: "accountId is required" });
      }
      // Import first requires 'purge', NOT 'write' (editor), because:
      //   (1) it is DESTRUCTIVE slice replacement — replaceAccountSlice deletes the account's
      //       entire scoped slice and re-inserts the import, the same hard-delete semantics the
      //       purge tier exists for (cf. the accounts-DELETE vectors); and
      //   (2) it BYPASSES field-level write pins — every id is remapped, so sanitizeWrite's
      //       existing-row pins (e.g. the P1.6 timeOff note pin) can never match a stored row.
      //       At 'write' tier a note-blind editor could erase every owner-confidential timeOff
      //       note (their own exports are note-redacted) or fabricate notes wholesale.
      // It is then narrowed to OWNER in auth-on mode: admins receive private clients/projects with
      // quoted cover names and no raw codeName. Their own valid export therefore cannot safely be
      // used as a replacement — it would turn the cover name into the persisted real name and repair
      // the missing code name to "Confidential", destroying the owner-only identity. OFF mode keeps
      // the open behaviour (demo/e2e parity — authorize no-ops there).
      if (!authorize(req, reply, body.accountId, "purge")) return;
      if (authMode !== "off") {
        const role = accountAdminPort.roleForPrincipalInWorkspace(req.user!.id, body.accountId);
        if (role === null || !canSeePrivateNames(role)) {
          return reply.code(403).send({ error: "Only the account owner can import data." });
        }
      }
      let incoming;
      try {
        incoming = parseData(JSON.stringify(body.data ?? {}));
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : "Invalid import data",
        });
      }
      // remapAndValidateImport drops/repairs dangling refs so the slice is FK-clean
      // before it hits SQLite; the try/catch is defence-in-depth so any residual DB
      // constraint failure becomes a 400 (via fail's classification) rather than an
      // uncaught 500.
      try {
        const currentSlice = store.readFullSlice(body.accountId);
        const expectedSnapshot = importSnapshotFingerprint(currentSlice);
        const result = await executeImportWorker(
          {
            current: currentSlice,
            accountId: body.accountId,
            incoming,
            now: new Date().toISOString(),
          },
          currentRequestAbortSignal(),
        );
        // Refuse a zero-record import rather than wiping the account's slice (mirrors the
        // client store guard — replacing a company's data with nothing is never intended).
        if (result.imported === 0) {
          return reply.code(400).send({
            error: "The import contained no usable records, so the company data was left unchanged.",
            imported: 0,
            skipped: result.skipped,
            maxRecords: MAX_IMPORT_RECORDS,
          });
        }
        const auditRecord: AuditRecord = {
          ts: new Date().toISOString(),
          userId: req.user!.id,
          accountId: body.accountId,
          action: "import",
          entity: "account",
          id: body.accountId,
          changedFields: [],
        };
        const auditOk = commitProductAudit(reply, auditRecord, () => {
          // The worker runs outside SQLite so ordinary writes stay responsive. Recheck the exact
          // tenant slice after BEGIN IMMEDIATE and before replacement: a same-account commit in the
          // worker window must conflict, never be silently erased by this destructive import.
          if (importSnapshotFingerprint(store.readFullSlice(body.accountId!)) !== expectedSnapshot) {
            throw new ImportSnapshotConflictError();
          }
          replaceAccountSlice(db, body.accountId!, validatedCompleteAccountSlice(result.data));
        });
        return {
          imported: result.imported,
          skipped: result.skipped,
          maxRecords: MAX_IMPORT_RECORDS,
          auditWarning: !auditOk,
        };
      } catch (err) {
        if (err instanceof WorkQueueFullError) {
          reply.header("retry-after", "1");
          return reply.code(503).send({ error: err.message, code: "IMPORT_BUSY", retryable: true });
        }
        if (err instanceof ImportSnapshotConflictError) {
          return reply.code(409).send({
            error: err.message,
            code: "IMPORT_SNAPSHOT_STALE",
          });
        }
        return sendFail(reply, err);
      }
    });

    // Test-only, trusted-local only: wipe (and optionally re-seed) so E2E/integration runs start
    // clean. An authenticated browser identity has tenant-scoped memberships, never installation-
    // wide erasure authority, so auth-on modes refuse this route even when allowReset was set.
    //
    // EXEMPT from the single-company cap: this is the raw insertAll test-only path (itself
    // production-forbidden — see bootGuard/resetForbidden, and opts.allowReset just below), not an
    // HTTP create vector the cap is meant to police. It's how e2e fixtures reach a known
    // multi-company state (the demo seed ships TWO companies) without threading multiAccount
    // through every spec.
    app.post("/api/test/reset", (req, reply) => {
      if (!opts.allowReset || authMode !== "off") {
        return reply.code(403).send({ error: "reset disabled" });
      }
      const body = (req.body ?? {}) as { seed?: boolean };
      tx(db, () => {
        wipe(db);
        if (body.seed) insertAll(db, seed());
      });
      return { ok: true };
    });
  });

  return app;
}
