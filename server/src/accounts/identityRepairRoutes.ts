import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { newId } from "@capacitylens/shared/lib/id";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Auth, AccountMode } from "../auth";
import type { SsoCutoverIdentityPort } from "./identityPort/contracts";
import type { SsoCutoverAccountAdminPort } from "./adminPort/contracts";
import { requireAccountActor } from "./routes/handlers/authenticatedPrincipal";

type IdentityRepairIdentity = Pick<SsoCutoverIdentityPort, "correctPrincipalEmail" | "removeFederatedLink">;
type IdentityRepairAdministration = Pick<
  SsoCutoverAccountAdminPort,
  "evaluateIdentityAdminAuthority" | "assertIdentityRepairAuthorityInTx"
>;

interface IdentityRepairRouteDependencies {
  auth: Auth;
  authMode: Exclude<AccountMode, "off">;
  identity: IdentityRepairIdentity;
  administration: IdentityRepairAdministration;
  applicationId: string;
  authorize(
    input: Omit<import("../routes/routeShared").AuthorizeRouteInput, "action"> & { action: "manageMembers" },
  ): boolean;
  fail(reply: FastifyReply, error: unknown): unknown;
}
type RouteRequest = FastifyRequest;

function requireCompanyProvider(auth: Auth, reply: FastifyReply): Auth["defaultCompanyProvider"] | undefined {
  if (!auth.defaultCompanyProvider) {
    reply.code(400).send({ error: "No company provider is configured." });
    return undefined;
  }
  return auth.defaultCompanyProvider;
}

/** Registers administrator-authorized identity repair endpoints. */
export function registerIdentityRepairRoutes(
  app: FastifyInstance,
  dependencies: IdentityRepairRouteDependencies,
): void {
  app.patch("/api/accounts/:accountId/members/:userId/email", async (req, reply) =>
    correctEmail(req, reply, dependencies),
  );
  app.delete("/api/accounts/:accountId/members/:userId/federated-link", async (req, reply) =>
    removeFederatedLink(req, reply, dependencies),
  );
}

async function correctEmail(req: RouteRequest, reply: FastifyReply, dependencies: IdentityRepairRouteDependencies) {
  const { accountId, userId } = req.params as { accountId: string; userId: string };
  if (!dependencies.authorize({ req, reply, accountId, action: "manageMembers" })) return;
  if (!allowsPasswordSignIn(dependencies.authMode)) {
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
    // Surface the failure through the account response boundary so callers receive the mapped status and safe error shape.
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
  dependencies: IdentityRepairRouteDependencies,
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
  dependencies: IdentityRepairRouteDependencies,
) {
  const { accountId, userId } = req.params as { accountId: string; userId: string };
  if (!dependencies.authorize({ req, reply, accountId, action: "manageMembers" })) return;
  if (!allowsPasswordSignIn(dependencies.authMode)) {
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
    // Surface the failure through the account response boundary so callers receive the mapped status and safe error shape.
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
  dependencies: IdentityRepairRouteDependencies,
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
