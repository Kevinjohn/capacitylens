import type { AuthorizeRouteInput } from "../routes/routeShared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { newId } from "@capacitylens/shared/lib/id";
import type { SsoReadinessReason } from "@capacitylens/shared/account/ssoCutover";
import type { Auth, AccountMode } from "../auth";
import type { SsoCutoverIdentityPort } from "./betterAuthIdentityPort";
import type { SsoCutoverAccountAdminPort } from "./sqliteAccountAdminPort";
import { ssoCutoverReadiness } from "./ssoCutover";

type AuthorizeMemberManagementInput = Omit<AuthorizeRouteInput, "action"> & { action: "manageMembers" };

function createAuthenticationRequiredError(): AccountContractError {
  return new AccountContractError({
    code: "AUTHENTICATION_REQUIRED",
    message: "Sign in to continue.",
    retryable: false,
  });
}

function requireAccountActor(req: FastifyRequest): NonNullable<FastifyRequest["accountActor"]> {
  if (!req.accountActor) throw createAuthenticationRequiredError();
  return req.accountActor;
}

function requireAuthenticatedUser(req: FastifyRequest): NonNullable<FastifyRequest["user"]> {
  if (!req.user) throw createAuthenticationRequiredError();
  return req.user;
}

function requireFederatedLink(auth: Auth): NonNullable<Auth["beginFederatedLink"]> {
  if (!auth.beginFederatedLink) throw new Error("Federated identity linking is not configured.");
  return auth.beginFederatedLink;
}

/** The 400 "no strict provider" guard shared byte-for-byte by the two write endpoints below (email
 *  correction, federated-link removal). Distinct from the 404 variant on GET /api/identity/provider
 *  and the pre-derived check inside sso-readiness — those are left untouched. Sends the response and
 *  returns undefined on failure so a call site that needs the provider can use it directly; neither
 *  current call site does, so both just test the return value. */
function requireStrictProvider(auth: Auth, reply: FastifyReply): Auth["strictProvider"] | undefined {
  if (!auth.strictProvider) {
    reply.code(400).send({ error: "No strict OIDC provider is configured." });
    return undefined;
  }
  return auth.strictProvider;
}

interface SsoCutoverRouteDependencies {
  auth: Auth;
  authMode: Exclude<AccountMode, "off">;
  identity: SsoCutoverIdentityPort;
  administration: SsoCutoverAccountAdminPort;
  applicationId: string;
  openSignup: boolean;
  authorize(input: AuthorizeMemberManagementInput): boolean;
  fail(reply: FastifyReply, error: unknown): unknown;
  toWebHeaders(headers: FastifyRequest["headers"]): Headers;
}

type RouteRequest = FastifyRequest;

function registerProviderRoutes(app: FastifyInstance, dependencies: SsoCutoverRouteDependencies): void {
  const { auth, identity, fail } = dependencies;
  app.get("/api/identity/provider", async (req, reply) => {
    const provider = auth.strictProvider;
    if (!provider) return reply.code(404).send({ error: "No strict OIDC provider is configured." });
    try {
      const links = identity.inspectProviderLinks(requireAuthenticatedUser(req).id, provider.id);
      return { provider, connected: links.length > 0, verified: links.length === 1 && links[0]?.verified === true };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/api/identity/link-provider", async (req, reply) => beginProviderLink(req, reply, dependencies));
}

async function beginProviderLink(req: RouteRequest, reply: FastifyReply, dependencies: SsoCutoverRouteDependencies) {
  const { auth, fail, toWebHeaders } = dependencies;
  if (!req.accountActor?.fresh) {
    return fail(
      reply,
      new AccountContractError({
        code: "SESSION_NOT_FRESH",
        message: "A fresh sign-in is required to connect an identity provider.",
        retryable: false,
      }),
    );
  }
  const body = (req.body ?? {}) as { callbackURL?: unknown; errorCallbackURL?: unknown };
  if (typeof body.callbackURL !== "string" || typeof body.errorCallbackURL !== "string") {
    return reply.code(400).send({ error: "Valid callback and error return URLs are required." });
  }
  try {
    const result = await requireFederatedLink(auth)({
      headers: toWebHeaders(req.headers),
      principalId: req.accountActor.principalId,
      callbackURL: body.callbackURL,
      errorCallbackURL: body.errorCallbackURL,
    });
    if (result.setCookies.length > 0) reply.header("set-cookie", result.setCookies);
    return { url: result.url };
  } catch (error) {
    return sendProviderLinkFailure(req, reply, error);
  }
}

const providerLinkFailureStatuses = new Map([
  ["SESSION_EXPIRED", 401],
  ["INVALID_CALLBACK_URL", 400],
  ["PROVIDER_NOT_FOUND", 400],
  ["PROVIDER_ALREADY_LINKED", 409],
  ["MULTIPLE_PROVIDER_LINKS", 409],
  ["PROVIDER_UNAVAILABLE", 502],
]);

function sendProviderLinkFailure(req: RouteRequest, reply: FastifyReply, error: unknown) {
  const body =
    error && typeof error === "object" && (error as { body?: unknown }).body
      ? (error as { body: { code?: unknown; message?: unknown } }).body
      : null;
  const code = body && typeof body.code === "string" ? body.code : null;
  const message = body && typeof body.message === "string" ? body.message : null;
  const status = code ? providerLinkFailureStatuses.get(code) : undefined;
  if (status) return reply.code(status).send({ error: message, code });
  req.log.error(error, "identity provider link initiation failed");
  return reply.code(500).send({ error: "The identity-provider connection could not be started." });
}

function registerReadinessRoute(app: FastifyInstance, dependencies: SsoCutoverRouteDependencies): void {
  app.get("/api/accounts/:accountId/sso-readiness", async (req, reply) => {
    const { accountId } = req.params as { accountId: string };
    if (
      !dependencies.authorize({
        req,
        reply,
        accountId,
        action: "manageMembers",
        options: { requireFreshSession: false },
      })
    )
      return;
    const provider = dependencies.auth.strictProvider;
    if (!provider) return reply.code(400).send({ error: "No strict OIDC provider is configured." });
    try {
      const readiness = ssoCutoverReadiness({
        provider,
        providers: dependencies.auth.providers,
        identity: dependencies.identity,
        administration: dependencies.administration,
        openSignup: dependencies.openSignup,
      });
      const workspace = readiness.workspaces.find((candidate) => candidate.workspaceId === accountId);
      if (!workspace) return reply.code(404).send({ error: "The workspace does not exist." });
      return {
        ...workspace,
        ready: readiness.ready,
        provider,
        globalIssues: safeReadinessIssues(readiness, accountId),
      };
    } catch (error) {
      return dependencies.fail(reply, error);
    }
  });
}

function safeReadinessIssues(readiness: ReturnType<typeof ssoCutoverReadiness>, accountId: string) {
  const issues = readiness.issues.filter((issue) => issue.workspaceId === null && issue.principalId === null);
  if (readiness.issues.some((issue) => issue.blocking && issue.workspaceId === null && issue.principalId !== null)) {
    issues.push(operatorRepairIssue());
  }
  if (
    readiness.issues.some((issue) => issue.blocking && issue.workspaceId !== null && issue.workspaceId !== accountId)
  ) {
    issues.push(otherWorkspaceIssue());
  }
  return issues;
}

type ReadinessIssue = ReturnType<typeof ssoCutoverReadiness>["issues"][number];

function operatorRepairIssue(): ReadinessIssue {
  return {
    reason: "operator_identity_repair_required" satisfies SsoReadinessReason,
    message: "Installation-wide identity repair is required; run the operator preflight for details.",
    blocking: true,
    critical: true,
    workspaceId: null,
    principalId: null,
  };
}

function otherWorkspaceIssue(): ReadinessIssue {
  return {
    reason: "other_workspace_not_ready" satisfies SsoReadinessReason,
    message: "Another company has cutover blockers; run the operator preflight for details.",
    blocking: true,
    critical: true,
    workspaceId: null,
    principalId: null,
  };
}

function registerRepairRoutes(app: FastifyInstance, dependencies: SsoCutoverRouteDependencies): void {
  app.patch("/api/accounts/:accountId/members/:userId/email", async (req, reply) =>
    correctEmail(req, reply, dependencies),
  );
  app.delete("/api/accounts/:accountId/members/:userId/federated-link", async (req, reply) =>
    removeFederatedLink(req, reply, dependencies),
  );
}

async function correctEmail(req: RouteRequest, reply: FastifyReply, dependencies: SsoCutoverRouteDependencies) {
  const { accountId, userId } = req.params as { accountId: string; userId: string };
  if (!dependencies.authorize({ req, reply, accountId, action: "manageMembers" })) return;
  if (dependencies.authMode !== "password") {
    return reply.code(409).send({
      error: "Sign-in email correction is available only during mixed-mode SSO staging.",
      code: "CONFLICT",
    });
  }
  if (!requireStrictProvider(dependencies.auth, reply)) return;
  const body = (req.body ?? {}) as { email?: unknown };
  const email = typeof body.email === "string" ? normalizeAccountEmail(body.email) : "";
  if (!isAccountEmail(email)) return reply.code(400).send({ error: "A valid email address is required." });
  try {
    await correctPrincipalEmail(req, dependencies, { accountId, userId, email });
    return reply.code(204).send();
  } catch (error) {
    return dependencies.fail(reply, error);
  }
}

interface EmailCorrectionInput {
  accountId: string;
  userId: string;
  email: string;
}

async function correctPrincipalEmail(
  req: RouteRequest,
  dependencies: SsoCutoverRouteDependencies,
  input: EmailCorrectionInput,
): Promise<void> {
  const { administration, identity, applicationId } = dependencies;
  const { accountId, userId, email } = input;
  const actor = requireAccountActor(req);
  const authority = await administration.evaluateIdentityAdminAuthority({
    actor,
    targetPrincipalId: userId,
    action: "correct-email",
  });
  if (!authority.allowed) {
    throw new AccountContractError({
      code: "FORBIDDEN",
      message: "You lack identity-global authority to correct this email address.",
      retryable: false,
    });
  }
  const occurredAt = new Date().toISOString();
  await identity.correctPrincipalEmail({
    principalId: userId,
    email,
    authorizeInTransaction: () =>
      administration.assertIdentityRepairAuthorityInTx({
        actor: requireAccountActor(req),
        workspaceId: accountId,
        targetPrincipalId: userId,
        action: "correct-email",
        expectedRevision: authority.revision,
      }),
    audit: {
      id: `identity-email:${userId}:${occurredAt}:${newId()}`,
      occurredAt,
      applicationId,
      workspaceId: accountId,
      actorPrincipalId: requireAccountActor(req).principalId,
      targetPrincipalId: userId,
      commandId: null,
      action: "identity.email_corrected",
      outcome: "success",
      changedFields: ["email", "sessions"],
    },
  });
}

interface FederatedLinkCoordinate {
  rowId: string;
  providerId: string;
  subject: string;
}

function parseFederatedLinkCoordinate(body: unknown): FederatedLinkCoordinate | undefined {
  const candidate = (body ?? {}) as { rowId?: unknown; providerId?: unknown; subject?: unknown };
  if (typeof candidate.rowId !== "string" || candidate.rowId.length === 0) return undefined;
  if (typeof candidate.providerId !== "string" || candidate.providerId.length === 0) return undefined;
  if (candidate.providerId === "credential") return undefined;
  if (typeof candidate.subject !== "string" || candidate.subject.length === 0) return undefined;
  return {
    rowId: candidate.rowId,
    providerId: candidate.providerId,
    subject: candidate.subject,
  };
}

async function removeFederatedLink(req: RouteRequest, reply: FastifyReply, dependencies: SsoCutoverRouteDependencies) {
  const { accountId, userId } = req.params as { accountId: string; userId: string };
  if (!dependencies.authorize({ req, reply, accountId, action: "manageMembers" })) return;
  if (dependencies.authMode !== "password") {
    return reply.code(409).send({
      error: "The required provider cannot be removed while SSO-only mode is active.",
      code: "CONFLICT",
    });
  }
  if (!requireStrictProvider(dependencies.auth, reply)) return;
  const coordinate = parseFederatedLinkCoordinate(req.body);
  if (!coordinate) return reply.code(400).send({ error: "An exact provider-link coordinate is required." });
  try {
    await removePrincipalFederatedLink(req, dependencies, { accountId, userId, coordinate });
    return reply.code(204).send();
  } catch (error) {
    return dependencies.fail(reply, error);
  }
}

interface FederatedLinkRemovalInput {
  accountId: string;
  userId: string;
  coordinate: FederatedLinkCoordinate;
}

async function removePrincipalFederatedLink(
  req: RouteRequest,
  dependencies: SsoCutoverRouteDependencies,
  input: FederatedLinkRemovalInput,
): Promise<void> {
  const { administration, identity, applicationId } = dependencies;
  const { accountId, userId, coordinate } = input;
  const actor = requireAccountActor(req);
  const authority = await administration.evaluateIdentityAdminAuthority({
    actor,
    targetPrincipalId: userId,
    action: "remove-federated-link",
  });
  if (!authority.allowed) {
    throw new AccountContractError({
      code: "FORBIDDEN",
      message: "You lack identity-global authority to repair this provider link.",
      retryable: false,
    });
  }
  const occurredAt = new Date().toISOString();
  const removed = await identity.removeFederatedLink({
    principalId: userId,
    ...coordinate,
    authorizeInTransaction: () =>
      administration.assertIdentityRepairAuthorityInTx({
        actor: requireAccountActor(req),
        workspaceId: accountId,
        targetPrincipalId: userId,
        action: "remove-federated-link",
        expectedRevision: authority.revision,
      }),
    audit: {
      id: `identity-unlink:${coordinate.rowId}:${occurredAt}`,
      occurredAt,
      applicationId,
      workspaceId: accountId,
      actorPrincipalId: requireAccountActor(req).principalId,
      targetPrincipalId: userId,
      commandId: null,
      action: "identity.federated_link_removed",
      outcome: "success",
      changedFields: ["federatedIdentity", "sessions"],
    },
  });
  if (!removed) {
    throw new AccountContractError({
      code: "CONFLICT",
      message: "The provider link changed after it was inspected. Refresh and try again.",
      retryable: false,
    });
  }
}

/** Register the authenticated provider-link and cutover-repair HTTP adapter. Provider lifecycle,
 * readiness policy, and storage remain behind their dedicated domain/port seams. */
export function registerSsoCutoverRoutes(app: FastifyInstance, dependencies: SsoCutoverRouteDependencies): void {
  registerProviderRoutes(app, dependencies);
  registerReadinessRoute(app, dependencies);
  registerRepairRoutes(app, dependencies);
}
