import type { AuthorizeRouteInput } from "./routeShared";
import type { FastifyRequest } from "fastify";
import type { Role, IdentityAdminAction, IdentityAdminAuthorityDecision } from "@capacitylens/shared/account/types";
import { ACCOUNT_SESSION_FRESH_AGE_SECONDS } from "@capacitylens/shared/account/sessionPolicy";
import { ALL_FIELDS_VISIBLE } from "./routeShared";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import { redactGatedEcho, hasGatedFields, resolveVisibilityForRole } from "../fieldPolicy";
import type { SanitizeWriteOptions } from "../fieldPolicy";
import { can } from "@capacitylens/shared/domain/access";
import type { resolveAppConfig } from "./appConfig";
import type { createAppRuntime } from "./appRuntime";
import type { installRootHooks } from "./appRootHooks";
import { FROZEN_REPLY_MESSAGES, REPLY_ERRORS } from "./replyErrors";

/** The outcome of an authorization check. */
export type AuthorizationResult = { kind: "allowed"; role: Role | null } | { kind: "denied" };
/** The result of resolving a user's effective role for an account. */
export type EffectiveRoleResult = { kind: "resolved"; role: Role | null } | { kind: "ended" };

interface CreateAuthorizationInput {
  runtime: ReturnType<typeof createAppRuntime>;
  config: ReturnType<typeof resolveAppConfig>;
  rootHelpers: ReturnType<typeof installRootHooks>;
}

type AppRuntime = ReturnType<typeof createAppRuntime>;
type RootHelpers = ReturnType<typeof installRootHooks>;
type ResolveEffectiveRole = (req: FastifyRequest, accountId: string) => EffectiveRoleResult;
interface MemberProjection {
  principalId: string;
  decisions: ReadonlyMap<string, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>;
}

function requireUser(req: FastifyRequest): NonNullable<FastifyRequest["user"]> {
  if (!req.user) throw new Error("Expected user context on an authenticated application route.");
  return req.user;
}

function requireAccountActor(req: FastifyRequest): NonNullable<FastifyRequest["accountActor"]> {
  if (!req.accountActor) throw new Error("Expected account actor context on an authenticated application route.");
  return req.accountActor;
}

// Resolve real membership before substituting a permitted masquerade role for its active account.
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
  if (options.concealNonMembership) reply.code(404).send({ error: FROZEN_REPLY_MESSAGES.notFound });
  else reply.code(403).send({ error: REPLY_ERRORS.forbidden });
  return { kind: "denied" };
}

function denyInsufficientRole(
  { req, reply, accountId, action }: AuthorizeRouteInput,
  role: Role,
  securityEvent: RootHelpers["securityEvent"],
): AuthorizationResult {
  securityEvent({ event: "authorization", outcome: "denied", action, accountId, userId: req.user?.id, role });
  reply.code(403).send({ error: REPLY_ERRORS.forbidden });
  return { kind: "denied" };
}

function optsOutOfFreshness(options: AuthorizeRouteInput["options"]): boolean {
  return options?.requireFreshSession === false;
}

function requireFreshSession(
  { req, reply, accountId, action, options = {} }: AuthorizeRouteInput,
  securityEvent: RootHelpers["securityEvent"],
): boolean {
  if (action === "read" || action === "write" || optsOutOfFreshness(options)) return true;
  // Sensitive actions fail closed on missing session timestamps; a fresh sign-in creates a dated session.
  // The fresh-session deadline is exclusive, matching idle-expiry rejection at the boundary.
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
    error: REPLY_ERRORS.freshSignInRequired,
    code: "SESSION_NOT_FRESH",
  });
  return false;
}

// Resolve active membership before capability and freshness checks; off mode performs no membership lookup.
// Authentication failures are handled upstream, while this boundary sends authorization refusals.
function createAuthorize({ authMode, resolveEffectiveRole, securityEvent }: AuthorizeInput) {
  return function authorize(input: AuthorizeRouteInput): AuthorizationResult {
    // Trusted-local mode is a no-op allow-all: neither the membership port nor `can` may run.
    if (authMode === "off") return { kind: "allowed", role: null };
    const resolved = resolveEffectiveRole(input.req, input.accountId);
    if (resolved.kind === "ended") {
      input.reply.code(403).send({ error: REPLY_ERRORS.masqueradeEnded, code: MASQUERADE_ERROR_CODES.ended });
      return { kind: "denied" };
    }
    const { role } = resolved;
    if (role === null) return denyMissingRole(input, securityEvent);
    if (!can(role, input.action)) return denyInsufficientRole(input, role, securityEvent);
    return requireFreshSession(input, securityEvent) ? { kind: "allowed", role } : { kind: "denied" };
  };
}

// Resolve visibility only for gated fields; missing or ended account context must hide them.
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

// A write echo is also a read and must preserve the current actor’s field confidentiality.
function redactWriteEcho(
  table: string,
  row: Record<string, unknown>,
  visibility: SanitizeWriteOptions,
): Record<string, unknown> {
  return redactGatedEcho(table, row, visibility);
}

/** Builds route authorization helpers from the application runtime and request hooks. */
export function createAuthorization({ runtime, config, rootHelpers }: CreateAuthorizationInput) {
  const { authMode } = config;
  const { securityEvent } = rootHelpers;
  const resolveEffectiveRole = createEffectiveRoleResolver(runtime);
  const readMemberProjection = createMemberProjectionReader(runtime);
  const readFieldVisibility = createFieldVisibility(authMode, resolveEffectiveRole);

  const authorize = createAuthorize({ authMode, resolveEffectiveRole, securityEvent });

  const authorizeAllowed = ({ req, reply, accountId, action, options = {} }: AuthorizeRouteInput): boolean =>
    authorize({ req, reply, accountId, action, options }).kind === "allowed";

  return {
    resolveEffectiveRole,
    memberReadProjection: readMemberProjection,
    authorize,
    authorizeAllowed,
    fieldVisibilityFor: readFieldVisibility,
    redactWriteEcho,
  };
}
