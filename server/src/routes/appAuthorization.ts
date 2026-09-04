import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type IdentityAdminAction, type IdentityAdminAuthorityDecision } from "@capacitylens/shared/account/types";
import { ACCOUNT_SESSION_FRESH_AGE_SECONDS } from "@capacitylens/shared/account/sessionPolicy";
import { ALL_FIELDS_VISIBLE } from "./routeShared";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import { redactGatedEcho, tableHasGatedFields, visibilityForRole, type SanitizeWriteOptions } from "../fieldPolicy";
import { can, type Action } from "@capacitylens/shared/domain/access";
import { resolveCorsOrigin, requestOriginIsSameOrigin } from "./appOriginPolicy";
import type { resolveAppConfig } from "./appConfig";
import type { createAppRuntime } from "./appRuntime";
import type { installRootHooks } from "./appRootHooks";
import type { AppOptions } from "../app";

export function createAuthorization(
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
