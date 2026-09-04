import type { ServerOptions as HttpsServerOptions } from "node:https";
import Fastify from "fastify";
import rateLimitPlugin from "@fastify/rate-limit";
import helmetPlugin from "@fastify/helmet";
import { MAX_RATE_LIMIT, normalizeRateLimit, parseRateLimit } from "./rateLimit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DEMO_USER, DEFAULT_ACCOUNT_APPLICATION, type Auth, type AuthMode, type SessionUser } from "./auth";
import {
  type ActorContext,
  type ApplicationSession,
  type BoundApplication,
  type CommandIdentity,
  type IdentityAdminAction,
  type IdentityAdminAuthorityDecision,
} from "@capacitylens/shared/account/types";
import { ACCOUNT_SESSION_FRESH_AGE_SECONDS } from "@capacitylens/shared/account/sessionPolicy";
import { AccountContractError, statusForAccountFailure } from "@capacitylens/shared/account/errors";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import {
  boundApplicationFailure,
  isAccountCommandId,
  isAccountIdempotencyKey,
} from "@capacitylens/shared/account/validation";
import { betterAuthIdentityPort, type SsoCutoverIdentityPort } from "./accounts/betterAuthIdentityPort";
import { sqliteAccountAdminPort } from "./accounts/sqliteAccountAdminPort";
import { registerSsoCutoverRoutes } from "./accounts/ssoCutoverRoutes";
import { actorContextFromSession, localAccountFlows } from "./accounts/localAccountFlows";
import { KeyedOperationLock } from "./accounts/operationLock";
import { trustedLocalIdentityPort } from "./accounts/trustedLocalIdentityPort";
import { registerAccountRoutes } from "./accounts/accountRoutes";
import { memberSignInTrackingSnapshot, setMemberSignInTracking } from "./accounts/memberSignInTracking";
import { registerLifecycleRoutes } from "./routes/lifecycleRoutes";
import { registerAuthProxyRoutes } from "./routes/authProxyRoutes";
import { MAX_BATCH_OPS, registerBatchRoutes } from "./routes/batchRoutes";
import { registerEntityRoutes } from "./routes/entityRoutes";
import { registerImportRoutes } from "./routes/importRoutes";
import { registerStateRoutes } from "./routes/stateRoutes";
import { CSP_REPORT_BODY_LIMIT, registerSystemRoutes } from "./routes/systemRoutes";
import { ALL_FIELDS_VISIBLE, isStaleWrite, ownsRow } from "./routes/routeShared";
import { applicationSessionHandle } from "./accounts/sessionHandle";
import { enqueueMasqueradeEndAudit, registerMasqueradeRoutes } from "./routes/masqueradeRoutes";
import { MasqueradeRegistry, type StoredMasqueradeRecord } from "./masqueradeRegistry";
import { MASQUERADE_ERROR_CODES, type MasqueradeEndReason } from "@capacitylens/shared/domain/masquerade";
// Every `accounts`-row write rule lives in ONE module (see its header). The generic /api/:entity
// routes below refuse `accounts` outright; the batch loop shares these predicates so the sync path
// and the dedicated routes cannot drift.
import { registerAccountEntityRoutes } from "./routes/accountEntityRoutes";
import { eraseWorkspaceProductDataInTx } from "./erasure";
import { runWithRequestAbortSignal } from "./requestAbort";

export { MAX_BATCH_OPS };

// The identity requireUser attaches to every gated request. Session/identity
// plumbing ONLY — accountId stays client-asserted (ownsRow is still the tenant guard);
// this is the seam Stage C will later use to derive accountId server-side.
declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
    accountActor: ActorContext | null;
    authenticationUserId: string | null;
    authenticationProviderId: string | null;
    session: ApplicationSession | null;
  }
}
import { ValidationError } from "./validate";
import { redactGatedEcho, tableHasGatedFields, visibilityForRole, type SanitizeWriteOptions } from "./fieldPolicy";
import { type Db, isInitialized } from "./db";
import { sqliteTenantStore } from "./tenantStore";
// P2.6b tenant erasure is composed below through AccountFlows: product data, account administration
// and local identity state retain separate owners while the local coordinator preserves one SQLite
// transaction for the dedicated deletion endpoint.
import { can, type Action } from "@capacitylens/shared/domain/access";
import { tx } from "./txn";
import { newId } from "@capacitylens/shared/lib/id";
import { type AuditRecord, type AuditSink, noopAuditSink } from "./audit";
import { enqueueAudit } from "./auditOutbox";
import { createAuditOutboxDrainer } from "./auditOutboxDrainer";
import { runImportWorker } from "./runImportWorker";

// ~5 MB request cap. A normal account is far smaller; an over-cap body is rejected
// by Fastify with 413 before our handlers run (mirrors the client's import guard).
const BODY_LIMIT = 5 * 1024 * 1024;

// Fastify defaults BOTH to 0 (disabled). The documented deploy fronts this server with Nginx,
// which buffers/queues the client connection — 30s is generous headroom for that hop, and it's
// the guard that protects the documented DIRECT-EXPOSURE mode (no reverse proxy) from a
// slowloris-style slow-body/slow-read socket exhaustion attack that an unbounded timeout permits.
const REQUEST_TIMEOUT_MS = 30_000;
const CONNECTION_TIMEOUT_MS = 30_000;
export const MAX_SERVER_CONNECTIONS = 512;

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

function resolveAppConfig(opts: AppOptions) {
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
  const logOn = opts.log === true;
  return { authMode, auth, rateLimitMax, application, executeImportWorker, auditSink, logOn };
}

function createAppRuntime(db: Db, config: ReturnType<typeof resolveAppConfig>, opts: AppOptions) {
  const { authMode, auth, application, auditSink } = config;
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
  const masquerades = new MasqueradeRegistry({
    expired: (record) => enqueueMasqueradeEndAudit(accountAudit, application.applicationId, record, "session_expired"),
  });
  const prepareMasqueradeUsers = (userIds: readonly string[], reason: "session_revoked"): readonly string[] => {
    const handles = [...new Set(userIds.flatMap((userId) => masquerades.sessionHandlesForUser(userId)))];
    for (const sessionHandle of handles) {
      masquerades.prepareEnd(sessionHandle, null, (record) =>
        enqueueMasqueradeEndAudit(accountAudit, application.applicationId, record, reason),
      );
    }
    return handles;
  };
  const masqueradeSessionLifecycle = {
    prepare: (sessionHandles: readonly string[], reason: "session_expired" | "session_revoked") => {
      for (const sessionHandle of sessionHandles) {
        masquerades.prepareEnd(sessionHandle, null, (record) =>
          enqueueMasqueradeEndAudit(accountAudit, application.applicationId, record, reason),
        );
      }
    },
    prepareUsers: prepareMasqueradeUsers,
    commit: (sessionHandles: readonly string[]) => masquerades.commitEnd(sessionHandles),
  };
  auth?.setSessionDeletionLifecycle?.({
    prepareSession: (sessionToken, reason) => {
      const handle = applicationSessionHandle(application.applicationId, sessionToken);
      masqueradeSessionLifecycle.prepare([handle], reason);
      return [handle];
    },
    prepareUser: (userId) => prepareMasqueradeUsers([userId], "session_revoked"),
    commit: masqueradeSessionLifecycle.commit,
  });
  const accountLock = new KeyedOperationLock();
  const identityPort =
    auth && authMode !== "off"
      ? betterAuthIdentityPort({
          applicationId: application.applicationId,
          auth,
          authMode,
          db,
          masqueradeSessions: masqueradeSessionLifecycle,
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

  const endMasquerade = (record: Readonly<StoredMasqueradeRecord>, reason: MasqueradeEndReason): void => {
    masquerades.end(record.sessionHandle, null, (ending) =>
      enqueueMasqueradeEndAudit(accountAudit, application.applicationId, ending, reason),
    );
  };

  return {
    auditDrainer,
    repliesWithAuditDrain,
    accountAudit,
    masquerades,
    prepareMasqueradeUsers,
    masqueradeSessionLifecycle,
    accountLock,
    identityPort,
    accountAdminPort,
    accountFlows,
    healthStmt,
    audit,
    drainProductAudit,
    commitProductAudit,
    store,
    endMasquerade,
  };
}

function installRootHooks(
  app: FastifyInstance,
  db: Db,
  runtime: ReturnType<typeof createAppRuntime>,
  config: ReturnType<typeof resolveAppConfig>,
  opts: AppOptions,
) {
  const { auditDrainer, repliesWithAuditDrain } = runtime;
  const { logOn, rateLimitMax } = config;
  app.addHook("onClose", () => auditDrainer.stop());
  app.addHook("onRequest", function abortOnClientDisconnect(request, reply, done) {
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

  return { sendFail, accountFail, securityEvent, corsOrigins };
}

function installSessionResolution(
  app: FastifyInstance,
  runtime: ReturnType<typeof createAppRuntime>,
  config: ReturnType<typeof resolveAppConfig>,
  opts: AppOptions,
  securityEvent: (event: Record<string, unknown>) => void,
) {
  const { accountAudit, identityPort, masquerades } = runtime;
  const { application, authMode } = config;
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
  app.decorateRequest("session", null);
  type SessionResolution =
    | { kind: "absent_or_invalid" }
    | { kind: "verified"; session: ApplicationSession }
    | { kind: "backend_failure"; error: unknown };
  const incomingSessionResolutions = new WeakMap<FastifyRequest, Promise<SessionResolution>>();
  const resolveIncomingSession = (req: FastifyRequest, force = false): Promise<SessionResolution> => {
    const existing = incomingSessionResolutions.get(req);
    if (existing) return existing;
    const credentialsPresent = req.headers.cookie !== undefined || req.headers.authorization !== undefined;
    if (authMode === "off" || (!credentialsPresent && !force)) {
      return Promise.resolve({ kind: "absent_or_invalid" });
    }
    const resolution = (async (): Promise<SessionResolution> => {
      try {
        const session = await identityPort!.verifyApplicationSession({ headers: toWebHeaders(req.headers) });
        return session ? { kind: "verified", session } : { kind: "absent_or_invalid" };
      } catch (error) {
        return { kind: "backend_failure", error };
      }
    })();
    incomingSessionResolutions.set(req, resolution);
    return resolution;
  };
  const attachVerifiedSession = (req: FastifyRequest, session: ApplicationSession): void => {
    const user = sessionUserFromApplicationSession(session);
    req.session = session;
    req.user = user;
    req.accountActor = actorContextFromSession(session);
    req.authenticationProviderId = session.assurance === "federated" ? session.providerId : null;
  };
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split("?", 1)[0];
    if (!path.startsWith("/api/") || path === "/api/health" || path === "/api/security/csp-report") return;
    let resolution = await resolveIncomingSession(req);
    if (resolution.kind === "verified") attachVerifiedSession(req, resolution.session);
    const activeMasquerade = resolution.kind === "verified" ? masquerades.lookup(resolution.session.id) : null;
    const unsafe = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
    const masqueradeExempt =
      activeMasquerade && unsafe
        ? (req.method === "POST" && /^\/api\/accounts\/[^/]+\/masquerade$/.test(path)) ||
          (req.method === "DELETE" && path === "/api/masquerade") ||
          (req.method === "POST" && path === "/api/account/sign-out") ||
          (req.method === "POST" && path === "/api/auth/sign-out")
        : false;
    if (activeMasquerade && unsafe && !masqueradeExempt) {
      securityEvent({
        event: "authorization",
        outcome: "denied",
        action: "masquerade_read_only",
        userId: resolution.kind === "verified" ? resolution.session.principal.id : undefined,
        method: req.method,
        path,
      });
      return reply.code(403).send({
        error: "Masquerade is read-only.",
        code: MASQUERADE_ERROR_CODES.readOnly,
      });
    }
    const signingOut =
      activeMasquerade && req.method === "POST" && (path === "/api/account/sign-out" || path === "/api/auth/sign-out");
    if (signingOut) {
      masquerades.end(activeMasquerade.sessionHandle, null, (record) =>
        enqueueMasqueradeEndAudit(accountAudit, application.applicationId, record, "sign_out"),
      );
    }
    if (resolution.kind === "backend_failure" && unsafe) {
      req.log.error(resolution.error);
      return reply.code(503).send({ error: "Sign-in is temporarily unavailable." });
    }
    if (path.startsWith("/api/auth/")) return;
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
    if (resolution.kind === "absent_or_invalid") {
      resolution = await resolveIncomingSession(req, true);
      if (resolution.kind === "verified") attachVerifiedSession(req, resolution.session);
    }
    if (resolution.kind === "backend_failure") {
      req.log.error(resolution.error);
      return reply.code(503).send({ error: "Sign-in is temporarily unavailable." });
    }
    if (resolution.kind === "absent_or_invalid") {
      securityEvent({
        event: "authentication_required",
        outcome: "blocked",
        method: req.method,
        path,
        remoteIp: requestClientIp(req, opts.trustProxyHeaders === true),
      });
      return reply.code(401).send({ error: "Sign in to continue." });
    }
    const session = resolution.session;
    const user = sessionUserFromApplicationSession(session);
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
  });

  return { resolveIncomingSession };
}

function createAuthorization(
  app: FastifyInstance,
  runtime: ReturnType<typeof createAppRuntime>,
  config: ReturnType<typeof resolveAppConfig>,
  opts: AppOptions,
  rootHelpers: ReturnType<typeof installRootHooks>,
) {
  const { accountAdminPort, endMasquerade, masquerades } = runtime;
  const { authMode } = config;
  const { corsOrigins, securityEvent } = rootHelpers;
  /** Resolve the real membership first, then substitute only the active account's target read role. */
  function resolveEffectiveRole(
    req: FastifyRequest,
    accountId: string,
  ): { role: ReturnType<typeof accountAdminPort.roleForPrincipalInWorkspace>; ended: boolean } {
    const realRole = accountAdminPort.roleForPrincipalInWorkspace(req.user!.id, accountId);
    const record = req.session ? masquerades.lookup(req.session.id) : null;
    if (!record || record.accountId !== accountId) return { role: realRole, ended: false };
    if (realRole === null || !can(realRole, "masquerade")) {
      endMasquerade(record, "caller_invalidated");
      return { role: null, ended: true };
    }
    const targetRole = accountAdminPort.roleForPrincipalInWorkspace(record.targetUserId, accountId);
    if (targetRole === null) {
      endMasquerade(record, "target_invalidated");
      return { role: null, ended: true };
    }
    return { role: targetRole, ended: false };
  }

  function memberReadProjection(
    req: FastifyRequest,
    accountId: string,
    targetPrincipalIds: readonly string[],
  ): {
    principalId: string;
    decisions: ReadonlyMap<string, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>;
  } {
    const record = req.session ? masquerades.peek(req.session.id) : null;
    const principalId = record?.accountId === accountId ? record.targetUserId : req.accountActor!.principalId;
    const decisions = accountAdminPort.projectIdentityAdminAuthoritiesForTargets({
      principalId,
      targetPrincipalIds,
      actions: ["issue-password-reset", "revoke-sessions"],
    });
    return { principalId, decisions };
  }

  /**
   * The authorization seam (P1.5 requirePermission): "may THIS request perform `action` on
   * `accountId`?". Returns the resolved role to proceed; otherwise it has already sent the route's denial and returns
   * `false`, so a caller guards with `if (!authorize(...)) return`.
   *
   * OFF mode (the default, trusted-local) is a NO-OP allow-all: it returns a successful null-role result
   * on the FIRST line, BEFORE any membership read — `req.user` is the synthetic DEMO_USER and the account
   * port / `can` never run. This pins the #1 invariant (OFF = exactly today's behaviour). Auth-on asks the
   * account administration port for the caller's active role and runs the pure `can(role, action)` matrix:
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
   * @returns The resolved role if allowed; `false` after sending the route's denial response.
   */
  function authorize(
    req: FastifyRequest,
    reply: FastifyReply,
    accountId: string,
    action: Action,
    options: { concealNonMembership?: boolean } = {},
  ): { role: ReturnType<typeof accountAdminPort.roleForPrincipalInWorkspace> } | false {
    if (authMode === "off") return { role: null }; // OFF = allow-all; the account port / can NEVER run.
    const resolved = resolveEffectiveRole(req, accountId);
    if (resolved.ended) {
      reply.code(403).send({ error: "Masquerade ended.", code: MASQUERADE_ERROR_CODES.ended });
      return false;
    }
    const role = resolved.role;
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
    return { role };
  }

  const authorizeAllowed = (
    req: FastifyRequest,
    reply: FastifyReply,
    accountId: string,
    action: Action,
    options: { concealNonMembership?: boolean } = {},
  ): boolean => authorize(req, reply, accountId, action, options) !== false;

  /** Writer visibility for the two field-level confidentiality policies. Only time off and
   * client/project writes pay the membership lookup; a non-string account id fails closed. */
  function fieldVisibilityFor(req: FastifyRequest, table: string, accountId: unknown): SanitizeWriteOptions {
    // No gated fields on this table (or trusted-local OFF) ⇒ fully visible, no membership lookup.
    if (!tableHasGatedFields(table) || authMode === "off") {
      return ALL_FIELDS_VISIBLE;
    }
    const role = typeof accountId === "string" ? resolveEffectiveRole(req, accountId).role : null; // a non-string account id fails closed (every gated field hidden)
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
  app.addHook("onRequest", async function enforceOriginPolicy(req: FastifyRequest, reply: FastifyReply) {
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

  return {
    resolveEffectiveRole,
    memberReadProjection,
    authorize,
    authorizeAllowed,
    fieldVisibilityFor,
    redactWriteEcho,
  };
}

function registerApiRoutes(
  app: FastifyInstance,
  db: Db,
  runtime: ReturnType<typeof createAppRuntime>,
  config: ReturnType<typeof resolveAppConfig>,
  opts: AppOptions,
  rootHelpers: ReturnType<typeof installRootHooks>,
  sessionResolution: ReturnType<typeof installSessionResolution>,
  authorization: ReturnType<typeof createAuthorization>,
): void {
  const {
    accountAdminPort,
    accountAudit,
    accountFlows,
    audit,
    auditDrainer,
    commitProductAudit,
    drainProductAudit,
    healthStmt,
    identityPort,
    masquerades,
    store,
  } = runtime;
  const { application, auditSink, auth, authMode, executeImportWorker, logOn } = config;
  const { accountFail, securityEvent, sendFail } = rootHelpers;
  const { resolveIncomingSession } = sessionResolution;
  const {
    authorize,
    authorizeAllowed,
    fieldVisibilityFor,
    memberReadProjection,
    redactWriteEcho,
    resolveEffectiveRole,
  } = authorization;
  // Every route below registers through a child plugin, NOT directly on the root:
  // @fastify/rate-limit attaches to routes via an onRoute hook that only exists once the
  // plugin LOADS (at ready(), in registration order) — a route declared straight on the
  // root would register first and silently escape the limiter. The child loads after it,
  // so its routes are seen, and it inherits the root CORS hook + error handler. The
  // callback shadows `app` deliberately: the route code is identical without the wrapper.
  void app.register(async (app) => {
    const systemRouteDependencies = {
      securityEvent,
      healthStatement: healthStmt,
      auditDrainer,
      auditSink,
      backupHealth: opts.backupHealth,
      internalTlsExpiresAt: opts.internalTlsExpiresAt,
      internalTlsFingerprintSha256: opts.internalTlsFingerprintSha256,
      isInitialized: () => isInitialized(db),
    };
    const authProxyRouteDependencies = {
      authMode,
      auth,
      db,
      multiAccount: opts.multiAccount === true,
      requireMfa: opts.requireMfa === true,
      accountAdminPort,
      masquerades,
      resolveIncomingSession,
      sessionUserFromApplicationSession,
      sessionSatisfiesRequiredMfa,
      toWebHeaders,
      logOn,
    };
    const stateRouteDependencies = {
      db,
      store,
      authMode,
      auth,
      multiAccount: opts.multiAccount === true,
      bootstrapToken: opts.bootstrapToken,
      accountAdminPort,
      accountFlows,
      masquerades,
      authorize,
      resolveEffectiveRole,
      accountCommand,
      accountFail,
      sendFail,
      drainProductAudit,
    };

    registerSystemRoutes(app, { ...systemRouteDependencies, section: "public" });

    registerAuthProxyRoutes(app, { ...authProxyRouteDependencies, section: "identity" });

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
        authorize: authorizeAllowed,
        fail: accountFail,
        toWebHeaders,
      });
      registerAuthProxyRoutes(app, { ...authProxyRouteDependencies, section: "proxy" });
    }

    registerStateRoutes(app, { ...stateRouteDependencies, section: "read" });

    registerSystemRoutes(app, { ...systemRouteDependencies, section: "meta" });

    registerStateRoutes(app, { ...stateRouteDependencies, section: "org" });

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
      authorize: authorizeAllowed,
      command: accountCommand,
      audit,
      fail: accountFail,
      memberReadProjection,
    });

    registerMasqueradeRoutes(app, {
      authMode,
      applicationId: application.applicationId,
      accountAudit,
      registry: masquerades,
      identity: identityPort,
      authorize: authorizeAllowed,
      roleForPrincipal: (principalId, accountId) =>
        accountAdminPort.roleForPrincipalInWorkspace(principalId, accountId),
      effectiveRole: resolveEffectiveRole,
    });

    registerLifecycleRoutes(app, {
      store,
      authorize: authorizeAllowed,
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
      authorize: authorizeAllowed,
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

    registerEntityRoutes(app, {
      db,
      store,
      authMode,
      optimisticConcurrency: opts.optimisticConcurrency !== false,
      authorize: authorizeAllowed,
      fieldVisibility: fieldVisibilityFor,
      redact: redactWriteEcho,
      commitProductAudit,
      fail: sendFail,
    });

    registerBatchRoutes(app, {
      db,
      store,
      authMode,
      multiAccount: opts.multiAccount === true,
      optimisticConcurrency: opts.optimisticConcurrency !== false,
      accountFlows,
      authorize: authorizeAllowed,
      fieldVisibility: fieldVisibilityFor,
      redact: redactWriteEcho,
      drainProductAudit,
      fail: sendFail,
      accountFail,
    });

    registerImportRoutes(app, {
      db,
      store,
      authMode,
      allowReset: opts.allowReset === true,
      accountAdminPort,
      authorize: authorizeAllowed,
      executeImportWorker,
      commitProductAudit,
      fail: sendFail,
    });
  });
}

export function buildApp(db: Db, opts: AppOptions = {}): FastifyInstance {
  const config = resolveAppConfig(opts);
  const runtime = createAppRuntime(db, config, opts);
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
    logger: config.logOn ? requestLoggerOptions(opts.logStream) : false,
  });
  const rootHelpers = installRootHooks(app, db, runtime, config, opts);
  const sessionResolution = installSessionResolution(app, runtime, config, opts, rootHelpers.securityEvent);
  const authorization = createAuthorization(app, runtime, config, opts, rootHelpers);
  registerApiRoutes(app, db, runtime, config, opts, rootHelpers, sessionResolution, authorization);
  return app;
}
