import type { AuthorizeRouteInput } from "../routes/routeShared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { newId } from "@capacitylens/shared/lib/id";
import type { Auth, AccountMode } from "../auth";
import type { SsoCutoverIdentityPort } from "./betterAuthIdentityPort";
import type { SsoCutoverAccountAdminPort } from "./sqliteAccountAdminPort";
import { providerLinkBodyError, sendProviderLinkFailure } from "./providerLinkFailure";
import { startMicrosoftProviderLink } from "./microsoftProviderLink";
import { requireAccountActor, requireAuthenticatedUser } from "./routes/handlers/authenticatedPrincipal";

type AuthorizeMemberManagementInput = Omit<AuthorizeRouteInput, "action"> & { action: "manageMembers" };

function requireFederatedLink(auth: Auth): NonNullable<Auth["beginFederatedLink"]> {
  if (!auth.beginFederatedLink) throw new Error("Federated identity linking is not configured.");
  return auth.beginFederatedLink;
}

/** Keep provider repair restricted to an installation with a configured company provider. */
function requireCompanyProvider(auth: Auth, reply: FastifyReply): Auth["defaultCompanyProvider"] | undefined {
  if (!auth.defaultCompanyProvider) {
    reply.code(400).send({ error: "No company provider is configured." });
    return undefined;
  }
  return auth.defaultCompanyProvider;
}

interface FederatedIdentityRouteDependencies {
  auth: Auth;
  authMode: Exclude<AccountMode, "off">;
  identity: SsoCutoverIdentityPort;
  administration: SsoCutoverAccountAdminPort;
  applicationId: string;
  authorize(input: AuthorizeMemberManagementInput): boolean;
  fail(reply: FastifyReply, error: unknown): unknown;
  toWebHeaders(headers: FastifyRequest["headers"]): Headers;
  trustProxyHeaders?: boolean;
}

type RouteRequest = FastifyRequest;

function registerProviderRoutes(app: FastifyInstance, dependencies: FederatedIdentityRouteDependencies): void {
  const { auth, identity, fail } = dependencies;
  app.get("/api/identity/provider", async (req, reply) => {
    const requestedProviderId = (req.query as { providerId?: unknown } | undefined)?.providerId;
    if (requestedProviderId !== undefined && typeof requestedProviderId !== "string") {
      return reply.code(400).send({ error: "A valid provider id is required." });
    }
    const provider =
      requestedProviderId === undefined
        ? auth.defaultCompanyProvider
        : auth.providers.find((candidate) => candidate.id === requestedProviderId && !candidate.experimental);
    if (!provider) return reply.code(404).send({ error: "No configured company provider was found." });
    try {
      const links = identity.inspectProviderLinks(requireAuthenticatedUser(req).id, provider.id);
      return { provider, connected: links.length > 0, verified: links.length === 1 && links[0]?.verified === true };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/api/identity/link-provider", async (req, reply) => beginProviderLink(req, reply, dependencies));
}

function resolveProviderLinkBody(
  body: { callbackURL?: unknown; errorCallbackURL?: unknown; providerId?: unknown },
  defaultProvider: Auth["defaultCompanyProvider"],
): { callbackURL: string; errorCallbackURL: string; providerId?: string } {
  const validBody = { ...body } as { callbackURL: string; errorCallbackURL: string; providerId?: string };
  if (validBody.providerId === undefined && defaultProvider) validBody.providerId = defaultProvider.id;
  return validBody;
}

async function beginProviderLink(
  req: RouteRequest,
  reply: FastifyReply,
  dependencies: FederatedIdentityRouteDependencies,
) {
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
  const body = (req.body ?? {}) as { callbackURL?: unknown; errorCallbackURL?: unknown; providerId?: unknown };
  const bodyError = providerLinkBodyError(body);
  if (bodyError) return reply.code(400).send({ error: bodyError });
  const validBody = resolveProviderLinkBody(body, auth.defaultCompanyProvider);
  if (validBody.providerId !== undefined && req.user?.emailVerified !== true) {
    return reply.code(403).send({
      error: "Verify the local account address before connecting an identity provider.",
      code: "LOCAL_EMAIL_NOT_VERIFIED",
    });
  }
  try {
    const headers = toWebHeaders(req.headers);
    const result =
      (await startMicrosoftProviderLink({
        auth,
        identity: dependencies.identity,
        request: req,
        body: validBody,
        headers,
        trustProxyHeaders: dependencies.trustProxyHeaders === true,
      })) ??
      (await requireFederatedLink(auth)({
        headers,
        principalId: req.accountActor.principalId,
        ...(validBody.providerId === undefined ? {} : { providerId: validBody.providerId }),
        callbackURL: validBody.callbackURL,
        errorCallbackURL: validBody.errorCallbackURL,
      }));
    if (result.setCookies.length > 0) reply.header("set-cookie", result.setCookies);
    return { url: result.url };
  } catch (error) {
    return sendProviderLinkFailure(req, reply, error);
  }
}

function registerRepairRoutes(app: FastifyInstance, dependencies: FederatedIdentityRouteDependencies): void {
  app.patch("/api/accounts/:accountId/members/:userId/email", async (req, reply) =>
    correctEmail(req, reply, dependencies),
  );
  app.delete("/api/accounts/:accountId/members/:userId/federated-link", async (req, reply) =>
    removeFederatedLink(req, reply, dependencies),
  );
}

async function correctEmail(req: RouteRequest, reply: FastifyReply, dependencies: FederatedIdentityRouteDependencies) {
  const { accountId, userId } = req.params as { accountId: string; userId: string };
  if (!dependencies.authorize({ req, reply, accountId, action: "manageMembers" })) return;
  if (dependencies.authMode !== "password") {
    return reply.code(409).send({
      error: "Sign-in email correction is available only during mixed-mode SSO staging.",
      code: "CONFLICT",
    });
  }
  if (!requireCompanyProvider(dependencies.auth, reply)) return;
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
  dependencies: FederatedIdentityRouteDependencies,
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

async function removeFederatedLink(
  req: RouteRequest,
  reply: FastifyReply,
  dependencies: FederatedIdentityRouteDependencies,
) {
  const { accountId, userId } = req.params as { accountId: string; userId: string };
  if (!dependencies.authorize({ req, reply, accountId, action: "manageMembers" })) return;
  if (dependencies.authMode !== "password") {
    return reply.code(409).send({
      error: "The required provider cannot be removed while SSO-only mode is active.",
      code: "CONFLICT",
    });
  }
  if (!requireCompanyProvider(dependencies.auth, reply)) return;
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
  dependencies: FederatedIdentityRouteDependencies,
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

/** Register authenticated provider linking and identity repair routes. */
export function registerFederatedIdentityRoutes(
  app: FastifyInstance,
  dependencies: FederatedIdentityRouteDependencies,
): void {
  registerProviderRoutes(app, dependencies);
  registerRepairRoutes(app, dependencies);
}
