import type { AuthorizeRouteInput } from "./routeShared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  type Role,
  type IdentityAdminAction,
  type IdentityAdminAuthorityDecision,
} from "@capacitylens/shared/account/types";
import { ACCOUNT_SESSION_FRESH_AGE_SECONDS } from "@capacitylens/shared/account/sessionPolicy";
import { ALL_FIELDS_VISIBLE } from "./routeShared";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import { redactGatedEcho, hasGatedFields, resolveVisibilityForRole, type SanitizeWriteOptions } from "../fieldPolicy";
import { can } from "@capacitylens/shared/domain/access";
import { resolveCorsOrigin, isSameRequestOrigin } from "./appOriginPolicy";
import type { resolveAppConfig } from "./appConfig";
import type { createAppRuntime } from "./appRuntime";
import type { installRootHooks } from "./appRootHooks";
import type { AppOptions } from "../app";

export type AuthorizationResult = { kind: "allowed"; role: Role | null } | { kind: "denied" };
export type EffectiveRoleResult = { kind: "resolved"; role: Role | null } | { kind: "ended" };

interface CreateAuthorizationInput {
  app: FastifyInstance;
  runtime: ReturnType<typeof createAppRuntime>;
  config: ReturnType<typeof resolveAppConfig>;
  options: AppOptions;
  rootHelpers: ReturnType<typeof installRootHooks>;
}

type AppRuntime = ReturnType<typeof createAppRuntime>;
type RootHelpers = ReturnType<typeof installRootHooks>;
type ResolveEffectiveRole = (req: FastifyRequest, accountId: string) => EffectiveRoleResult;
interface MemberProjection {
  principalId: string;
  decisions: ReadonlyMap<string, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>;
}

interface TrustedOriginInput {
  req: FastifyRequest;
  listedOrigin: string | null;
  fetchSite: string | undefined;
  trustForwarded: boolean;
}

function resolveTrustedOrigin({ req, listedOrigin, fetchSite, trustForwarded }: TrustedOriginInput): string | null {
  if (listedOrigin !== null) return listedOrigin;
  const reqOrigin = req.headers.origin;
  if (reqOrigin === undefined) return null;
  if (fetchSite === "same-origin" || isSameRequestOrigin({ req, reqOrigin, trustForwarded })) return reqOrigin;
  return null;
}

function requireUser(req: FastifyRequest): NonNullable<FastifyRequest["user"]> {
  if (!req.user) throw new Error("Expected user context on an authenticated application route.");
  return req.user;
}

function requireAccountActor(req: FastifyRequest): NonNullable<FastifyRequest["accountActor"]> {
  if (!req.accountActor) throw new Error("Expected account actor context on an authenticated application route.");
  return req.accountActor;
}

/** Resolve real membership first, then substitute only the active account's masquerade target role. */
function createEffectiveRoleResolver(runtime: AppRuntime): ResolveEffectiveRole {
  const { accountAdminPort, endMasquerade, masquerades } = runtime;
  return function resolveEffectiveRole(req, accountId) {
    const realRole = accountAdminPort.roleForPrincipalInWorkspace(requireUser(req).id, accountId);
    const record = req.session ? masquerades.lookup(req.session.id) : null;
    if (!record || record.accountId !== accountId) return { kind: "resolved", role: realRole };
    if (realRole === null || !can(realRole, "masquerade")) {
      endMasquerade(record, "caller_invalidated");
      return { kind: "ended" };
    }
    const targetRole = accountAdminPort.roleForPrincipalInWorkspace(record.targetUserId, accountId);
    if (targetRole === null) {
      endMasquerade(record, "target_invalidated");
      return { kind: "ended" };
    }
    return { kind: "resolved", role: targetRole };
  };
}

function createMemberProjectionReader(runtime: AppRuntime) {
  const { accountAdminPort, masquerades } = runtime;
  return function readMemberProjection(
    req: FastifyRequest,
    accountId: string,
    targetPrincipalIds: readonly string[],
  ): MemberProjection {
    const record = req.session ? masquerades.peek(req.session.id) : null;
    const principalId = record?.accountId === accountId ? record.targetUserId : requireAccountActor(req).principalId;
    const decisions = accountAdminPort.projectIdentityAdminAuthoritiesForTargets({
      principalId,
      targetPrincipalIds,
      actions: ["issue-password-reset", "revoke-sessions"],
    });
    return { principalId, decisions };
  };
}

interface AuthorizeInput {
  authMode: ReturnType<typeof resolveAppConfig>["authMode"];
  resolveEffectiveRole: ResolveEffectiveRole;
  securityEvent: RootHelpers["securityEvent"];
}

function denyMissingRole(
  { req, reply, accountId, action, options = {} }: AuthorizeRouteInput,
  securityEvent: RootHelpers["securityEvent"],
): AuthorizationResult {
  securityEvent({ event: "authorization", outcome: "denied", action, accountId, userId: req.user?.id });
  if (options.concealNonMembership) reply.code(404).send({ error: "Not found" });
  else reply.code(403).send({ error: "Forbidden." });
  return { kind: "denied" };
}

function denyInsufficientRole(
  { req, reply, accountId, action }: AuthorizeRouteInput,
  role: Role,
  securityEvent: RootHelpers["securityEvent"],
): AuthorizationResult {
  securityEvent({ event: "authorization", outcome: "denied", action, accountId, userId: req.user?.id, role });
  reply.code(403).send({ error: "Forbidden." });
  return { kind: "denied" };
}

function requireFreshSession(
  { req, reply, accountId, action }: AuthorizeRouteInput,
  securityEvent: RootHelpers["securityEvent"],
): boolean {
  if (action === "read" || action === "write") return true;
  // Privileged actions fail closed when their session timestamp is absent or malformed. A fresh
  // sign-in always restores access by minting a dated session, so this cannot permanently lock out
  // an administrator. Date.parse of the empty fallback is NaN, which fails the finite check.
  // The inclusive deadline matches session-activity enforcement: the bound is the last safe instant.
  const sessionCreatedAtMs = Date.parse(req.user?.sessionCreatedAt ?? "");
  const timestampMissing = !Number.isFinite(sessionCreatedAtMs);
  if (!timestampMissing && Date.now() - sessionCreatedAtMs < ACCOUNT_SESSION_FRESH_AGE_SECONDS * 1000) return true;
  securityEvent({
    event: "step_up_required",
    outcome: "blocked",
    action,
    accountId,
    userId: req.user?.id,
    // Distinguish record-integrity failures from an ordinarily aged-out session.
    ...(timestampMissing ? { reason: "missing_session_timestamp" } : {}),
  });
  reply.code(403).send({
    error: "Sign in again before performing this security-sensitive action.",
    code: "SESSION_NOT_FRESH",
  });
  return false;
}

/**
 * Decide whether this request may perform an action on an account. Trusted-local mode returns
 * before any membership read. Authenticated mode resolves the request principal's active
 * membership (or active masquerade target), then applies membership, capability and fresh-session
 * checks in that order. Authentication/backend failures are handled by the upstream preHandler;
 * this seam sends only its established 403 response, or the row-concealing 404 for non-members.
 */
function createAuthorize({ authMode, resolveEffectiveRole, securityEvent }: AuthorizeInput) {
  return function authorize(input: AuthorizeRouteInput): AuthorizationResult {
    // Trusted-local mode is a no-op allow-all: neither the membership port nor `can` may run.
    if (authMode === "off") return { kind: "allowed", role: null };
    const resolved = resolveEffectiveRole(input.req, input.accountId);
    if (resolved.kind === "ended") {
      input.reply.code(403).send({ error: "Masquerade ended.", code: MASQUERADE_ERROR_CODES.ended });
      return { kind: "denied" };
    }
    const { role } = resolved;
    if (role === null) return denyMissingRole(input, securityEvent);
    if (!can(role, input.action)) return denyInsufficientRole(input, role, securityEvent); // member, tier too low
    return requireFreshSession(input, securityEvent) ? { kind: "allowed", role } : { kind: "denied" };
  };
}

/** Gated writes alone pay the role lookup; invalid or ended account context hides gated fields. */
function createFieldVisibility(
  authMode: ReturnType<typeof resolveAppConfig>["authMode"],
  resolveRole: ResolveEffectiveRole,
) {
  return function readFieldVisibility(req: FastifyRequest, table: string, accountId: unknown): SanitizeWriteOptions {
    if (authMode === "off") return ALL_FIELDS_VISIBLE;
    if (table !== "accounts" && !hasGatedFields(table)) return ALL_FIELDS_VISIBLE;
    const resolved = typeof accountId === "string" ? resolveRole(req, accountId) : null;
    const role = resolved?.kind === "resolved" ? resolved.role : null;
    const visibility = resolveVisibilityForRole(role);
    visibility.canChangeCapacityOverviewAccess = role !== null && (role === "owner" || role === "admin");
    return visibility;
  };
}

/** Apply read confidentiality to write, conflict and lifecycle response echoes. */
function redactWriteEcho(
  table: string,
  row: Record<string, unknown>,
  visibility: SanitizeWriteOptions,
): Record<string, unknown> {
  return redactGatedEcho(table, row, visibility);
}

export function createAuthorization({ app, runtime, config, options, rootHelpers }: CreateAuthorizationInput) {
  const { authMode } = config;
  const { corsOrigins, securityEvent } = rootHelpers;
  const resolveEffectiveRole = createEffectiveRoleResolver(runtime);
  const readMemberProjection = createMemberProjectionReader(runtime);
  const readFieldVisibility = createFieldVisibility(authMode, resolveEffectiveRole);

  const authorize = createAuthorize({ authMode, resolveEffectiveRole, securityEvent });

  const authorizeAllowed = ({ req, reply, accountId, action, options = {} }: AuthorizeRouteInput): boolean =>
    authorize({ req, reply, accountId, action, options }).kind === "allowed";

  // CORS response headers are not a CSRF control: browsers can still SEND a simple form request
  // and merely hide the response. Reject unsafe cross-site browser requests before routing, then
  // add CORS headers for explicitly trusted origins. Requests without Origin/Sec-Fetch-Site are
  // retained for CLI/server clients; modern browsers supply at least one signal for a cross-site
  // unsafe request. This hook MUST live on the ROOT instance, not in the routes child
  // below: there are no OPTIONS routes, so a preflight takes the not-found path, and
  // only root-level hooks run there — a child-scoped hook would leave preflights as
  // bare 404s without CORS headers, silently blocking every cross-origin write.
  app.addHook("onRequest", async function enforceOriginPolicy(req: FastifyRequest, reply: FastifyReply) {
    const reqOrigin = req.headers.origin;
    const listedOrigin = resolveCorsOrigin(reqOrigin, corsOrigins);
    const fetchSite = req.headers["sec-fetch-site"];
    // Sec-Fetch-Site is a forbidden browser-controlled header and therefore the most direct signal
    // for the packaged proxy path (where an outer TLS edge or non-default port can make server-side
    // origin reconstruction ambiguous). Exact scheme/Host comparison remains the fallback for
    // older clients that do not send Fetch Metadata. trustProxyHeaders is the shared deployment
    // posture: it also controls X-Forwarded-For rate-limit identity above, and only trusted proxies
    // that overwrite both headers may enable it.
    const origin = resolveTrustedOrigin({
      req,
      listedOrigin,
      fetchSite,
      trustForwarded: options.trustProxyHeaders === true,
    });
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    // An Origin exactly on the credentialed CORS allow-list (listedOrigin, folded into `origin`
    // above) is the operator's EXPLICIT cross-site contract, so it passes the gate regardless of
    // Fetch Metadata — a `Sec-Fetch-Site: cross-site` on an allow-listed Origin is exactly the
    // legitimate configured cross-origin call, not an attack. We therefore block only when the
    // request resolved to NO trusted origin (`origin === null`, i.e. neither allow-listed nor
    // same-origin) AND there is a cross-site signal: an Origin header we could not trust, or an
    // explicit cross-site Fetch Metadata label (which also catches Origin-less browser writes).
    if (unsafe && origin === null && (reqOrigin !== undefined || fetchSite === "cross-site")) {
      securityEvent({
        event: "cross_site_request",
        outcome: "blocked",
        method: req.method,
        path: req.url,
        origin: reqOrigin,
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
    memberReadProjection: readMemberProjection,
    authorize,
    authorizeAllowed,
    fieldVisibilityFor: readFieldVisibility,
    redactWriteEcho,
  };
}
