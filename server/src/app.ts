import type { ServerOptions as HttpsServerOptions } from "node:https";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { type Auth, type AuthMode, type SessionUser } from "./auth";
import { type ActorContext, type ApplicationSession, type BoundApplication } from "@capacitylens/shared/account/types";
import { type Db } from "./db";
import { type AuditSink } from "./audit";
import { runImportWorker } from "./runImportWorker";
import { BODY_LIMIT, REQUEST_TIMEOUT_MS, CONNECTION_TIMEOUT_MS } from "./routes/appLimits";
import { requestLoggerOptions } from "./routes/appLogging";
import { resolveAppConfig } from "./routes/appConfig";
import { createAppRuntime } from "./routes/appRuntime";
import { installRootHooks } from "./routes/appRootHooks";
import { installSessionResolution } from "./routes/appSessionResolution";
import { createAuthorization } from "./routes/appAuthorization";
import { registerApiRoutes } from "./routes/appRouteTree";
export { MAX_BATCH_OPS } from "./routes/batchRoutes";
export { MAX_RATE_LIMIT, parseRateLimit } from "./rateLimit";
export { statusFor, requestClientIp } from "./routes/appErrors";
export { requestLoggerOptions } from "./routes/appLogging";
export { MAX_SERVER_CONNECTIONS } from "./routes/appLimits";

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
