import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { Role } from "@capacitylens/shared/account/types";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import { cleanText } from "@capacitylens/shared/lib/strings";
import type { FastifyReply, FastifyRequest } from "fastify";
import { INVALID_ROLE_MESSAGE } from "../accountRouteDependencies";
import { parseStrictIsoInstant } from "../isoInstant";
import type { AccountRouteContext } from "../createReplyHelpers";

function createAuthenticationRequiredError() {
  return new AccountContractError({
    code: "AUTHENTICATION_REQUIRED",
    message: "Sign in to continue.",
    retryable: false,
  });
}

function requireAccountActor(req: FastifyRequest) {
  if (!req.accountActor) throw createAuthenticationRequiredError();
  return req.accountActor;
}

function requireAuthenticatedUser(req: FastifyRequest) {
  if (!req.user) throw createAuthenticationRequiredError();
  return req.user;
}

function requireAuthenticatedPrincipal(req: FastifyRequest) {
  return { actor: requireAccountActor(req), user: requireAuthenticatedUser(req) };
}

type ParseResult<T, E> = { value: T; failure?: never } | { failure: E; value?: never };

function parsePreauthorizedEmail(
  value: unknown,
  createValidationFailure: AccountRouteContext["validationFailed"],
): ParseResult<string | null, AccountContractError> {
  if (value !== undefined && typeof value !== "string") {
    return { failure: createValidationFailure("preauthEmail must be a valid email address.") };
  }
  if (typeof value !== "string" || value.trim().length === 0) return { value: null };
  return { value: normalizeAccountEmail(value) };
}

function parseInvitationExpiry(
  value: unknown,
  createValidationFailure: AccountRouteContext["validationFailed"],
): ParseResult<string | null, AccountContractError> {
  if (value === undefined) return { value: null };
  const parsed = typeof value === "string" ? parseStrictIsoInstant(value) : null;
  if (parsed === null) {
    return { failure: createValidationFailure("expiresAt must be a valid ISO-8601 timestamp.") };
  }
  return { value: new Date(parsed).toISOString() };
}

function parseCreateInvitationAuthorizationInput({
  req,
  authMode,
  isKnownRole,
  createValidationFailure,
}: {
  req: FastifyRequest;
  authMode: AccountRouteContext["authMode"];
  isKnownRole: AccountRouteContext["isKnownRole"];
  createValidationFailure: AccountRouteContext["validationFailed"];
}): ParseResult<
  { accountId: string; role: Role; preauthEmail: string | null; requestedExpiry: unknown },
  AccountContractError
> {
  const body = (req.body ?? {}) as {
    accountId?: unknown;
    role?: unknown;
    expiresAt?: unknown;
    preauthEmail?: unknown;
  };
  if (typeof body.accountId !== "string" || body.accountId.length === 0) {
    return { failure: createValidationFailure("accountId must be a non-empty string.") };
  }
  if (!isKnownRole(body.role)) return { failure: createValidationFailure(INVALID_ROLE_MESSAGE) };

  const emailResult = parsePreauthorizedEmail(body.preauthEmail, createValidationFailure);
  if ("failure" in emailResult) return { failure: emailResult.failure };
  if (authMode === "sso" && emailResult.value === null) {
    return { failure: createValidationFailure("SSO-only onboarding requires an email-preauthorized invitation.") };
  }

  return {
    value: {
      accountId: body.accountId,
      role: body.role,
      preauthEmail: emailResult.value,
      requestedExpiry: body.expiresAt,
    },
  };
}

function parseSignupInvitationInput(
  req: FastifyRequest,
): ParseResult<{ email: string; name: string; password: string }, string> {
  const body = (req.body ?? {}) as {
    email?: unknown;
    name?: unknown;
    password?: unknown;
  };
  const email = typeof body.email === "string" ? normalizeAccountEmail(body.email) : "";
  if (!isAccountEmail(email)) return { failure: "A valid email address is required." };
  const name = typeof body.name === "string" ? cleanText(body.name) : "";
  if (name.length === 0) return { failure: "Name is required." };
  if (typeof body.password !== "string" || passwordLengthFailure(body.password)) {
    return { failure: `Password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters.` };
  }
  return { value: { email, name, password: body.password } };
}

export async function createInvitation(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const {
    authMode,
    administration: accountAdminPort,
    authorize,
    command: accountCommand,
    fail: accountFail,
    isKnownRole,
    validationFailed: createValidationFailure,
    auditUnlessReplayed,
  } = context;

  const input = parseCreateInvitationAuthorizationInput({ req, authMode, isKnownRole, createValidationFailure });
  if ("failure" in input) return accountFail(reply, input.failure);
  const { value } = input;
  // Gate BEFORE any write: admin+ of this account may create invites; a non-member/under-tier is 403.
  if (!authorize({ req, reply, accountId: value.accountId, action: "manageInvites" })) return;
  const expiryResult = parseInvitationExpiry(value.requestedExpiry, createValidationFailure);
  if ("failure" in expiryResult) return accountFail(reply, expiryResult.failure);
  try {
    const { actor, user } = requireAuthenticatedPrincipal(req);
    const invite = await accountAdminPort.createInvitation({
      actor,
      workspaceId: value.accountId,
      role: value.role,
      preauthorizedEmail: value.preauthEmail,
      // Null is canonical across retries; the port chooses the bounded default only on first execution.
      expiresAt: expiryResult.value,
      command: accountCommand(req),
    });
    auditUnlessReplayed({
      reply,
      result: invite,
      record: {
        ts: invite.createdAt,
        userId: user.id,
        accountId: invite.workspaceId,
        action: "inviteCreate",
        entity: "invite",
        id: invite.id,
        changedFields: ["role", "preauthEmail", "expiresAt"],
      },
    });
    // Echo back what the caller needs to build the link — NOT createdAt/usedAt. preauthEmail is
    // echoed (the admin set it; convenient confirmation of the NORMALIZED value), and only to this
    // already-authorised admin. Later privileged invitation-list reads also expose it, but no
    // public preview or bearer-token read does.
    return reply.code(201).send({
      id: invite.id,
      token: invite.token,
      accountId: invite.workspaceId,
      role: invite.role,
      expiresAt: invite.expiresAt,
      preauthEmail: invite.preauthorizedEmail,
    });
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function previewInvitation(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const { administration: accountAdminPort, fail: accountFail } = context;

  const { token } = req.params as { token: string };
  try {
    const invite = await accountAdminPort.previewInvitation({ token });
    return {
      accountName: invite.workspaceName,
      role: invite.role,
      expiresAt: invite.expiresAt,
    };
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function acceptInvitation(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const {
    authMode,
    requiredSsoProviderId,
    administration: accountAdminPort,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
  } = context;

  const { token } = req.params as { token: string };
  const { accountActor: actor, user } = req;
  if (!actor || !user) return accountFail(reply, createAuthenticationRequiredError());
  try {
    if (
      authMode === "sso" &&
      (requiredSsoProviderId === null || req.authenticationProviderId !== requiredSsoProviderId)
    ) {
      // Preserve the route's unknown/used/expired precedence without consuming the invitation.
      // A valid token then receives the provider-specific refusal before any membership write.
      await accountAdminPort.previewInvitation({ token });
      throw new AccountContractError({
        code: "FORBIDDEN",
        message: "Sign in with the required SSO provider before accepting this invitation.",
        retryable: false,
      });
    }
    const accepted =
      authMode === "off"
        ? await accountAdminPort.claimInvitationForPrincipal({
            token,
            principalId: actor.principalId,
            principalEmail: user.email,
            emailVerified: true,
            passwordMode: false,
            command: accountCommand(req),
          })
        : await accountAdminPort.acceptInvitation({
            actor,
            token,
            principalEmail: user.email,
            emailVerified: user.emailVerified,
            command: accountCommand(req),
          });
    const now = new Date().toISOString();
    auditUnlessReplayed({
      reply,
      result: accepted,
      record: {
        ts: now,
        userId: user.id,
        accountId: accepted.workspaceId,
        action: "inviteAccept",
        entity: "membership",
        id: user.id,
        changedFields: ["role"],
      },
    });
    return reply.code(200).send({ accountId: accepted.workspaceId, role: accepted.role });
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function signupInvitation(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const {
    authMode,
    authenticationConfigured,
    flows: accountFlows,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
  } = context;

  if (authMode !== "password" || !authenticationConfigured) {
    return reply.code(404).send({ error: "Not found." });
  }
  const { token } = req.params as { token: string };
  const input = parseSignupInvitationInput(req);
  if ("failure" in input) return reply.code(400).send({ error: input.failure });
  const { value } = input;
  try {
    const result = await accountFlows.acceptInviteWithPasswordSignup({
      token,
      email: value.email,
      displayName: value.name,
      password: value.password,
      command: accountCommand(req),
    });
    auditUnlessReplayed({
      reply,
      result,
      record: {
        ts: new Date().toISOString(),
        userId: result.principalId,
        accountId: result.membership.workspaceId,
        action: "inviteAccept",
        entity: "member",
        id: result.principalId,
        changedFields: ["role", "status"],
      },
    });
    return reply.code(201).send({
      ok: true,
      accountId: result.membership.workspaceId,
      role: result.membership.role,
    });
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function listInvitations(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const { authMode, administration: accountAdminPort, authorize, fail: accountFail } = context;

  const { accountId } = req.params as { accountId: string };
  if (!authorize({ req, reply, accountId, action: "manageInvites", options: { requireFreshSession: false } })) return;
  if (authMode === "off") return { invites: [] };
  try {
    const invites = await accountAdminPort.listInvitations({
      actor: requireAccountActor(req),
      workspaceId: accountId,
      requireFresh: false,
    });
    return {
      invites: invites.map((invite) => ({
        id: invite.id,
        accountId: invite.workspaceId,
        role: invite.role,
        preauthEmail: invite.preauthorizedEmail,
        expiresAt: invite.expiresAt,
        usedAt: invite.usedAt,
        createdAt: invite.createdAt,
      })),
    };
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function revokeInvitation(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const {
    administration: accountAdminPort,
    authorize,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
  } = context;

  const { accountId, id } = req.params as { accountId: string; id: string };
  if (!authorize({ req, reply, accountId, action: "manageInvites" })) return;
  try {
    const { actor, user } = requireAuthenticatedPrincipal(req);
    const revoked = await accountAdminPort.revokeInvitation({
      actor,
      workspaceId: accountId,
      invitationId: id,
      command: accountCommand(req),
    });
    auditUnlessReplayed({
      reply,
      result: revoked,
      record: {
        ts: new Date().toISOString(),
        userId: user.id,
        accountId,
        action: "inviteRevoke",
        entity: "invite",
        id,
        changedFields: [],
      },
      ...(revoked.changed === undefined ? {} : { extra: revoked.changed }),
    });
    return reply.code(204).send();
  } catch (error) {
    return accountFail(reply, error);
  }
}
