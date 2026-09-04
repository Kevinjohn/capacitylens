import { AccountContractError } from "@capacitylens/shared/account/errors";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import { cleanText } from "@capacitylens/shared/lib/strings";
import type { FastifyReply, FastifyRequest } from "fastify";
import { INVALID_ROLE_MESSAGE } from "../accountRouteDependencies";
import { parseStrictIsoInstant } from "../isoInstant";
import type { AccountRouteContext } from "../replyHelpers";

export async function createInvitation(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const {
    authMode,
    administration: accountAdminPort,
    authorize,
    command: accountCommand,
    fail: accountFail,
    isKnownRole,
    validationFailed,
    auditUnlessReplayed,
  } = ctx;

  const body = (req.body ?? {}) as {
    accountId?: unknown;
    role?: unknown;
    expiresAt?: unknown;
    preauthEmail?: unknown;
  };
  if (typeof body.accountId !== "string" || body.accountId.length === 0) {
    return accountFail(reply, validationFailed("accountId must be a non-empty string."));
  }
  if (!isKnownRole(body.role)) {
    return accountFail(reply, validationFailed(INVALID_ROLE_MESSAGE));
  }
  // Shape-check preauthEmail here before authorize(): an absent value or a string that is empty
  // after trim means a link invite (null), while any present non-string is invalid. Email syntax
  // remains enforced by the account-administration port after authorization, keeping the
  // transport-independent integrity boundary authoritative without changing 400/403 precedence.
  let preauthEmail: string | null = null;
  if (body.preauthEmail !== undefined && typeof body.preauthEmail !== "string") {
    return accountFail(reply, validationFailed("preauthEmail must be a valid email address."));
  }
  if (typeof body.preauthEmail === "string") {
    const trimmed = body.preauthEmail.trim();
    if (trimmed.length > 0) {
      preauthEmail = normalizeAccountEmail(trimmed); // store normalized so accept compares normalized↔normalized
    }
  }
  if (authMode === "sso" && preauthEmail === null) {
    return accountFail(reply, validationFailed("SSO-only onboarding requires an email-preauthorized invitation."));
  }
  // Gate BEFORE any write: admin+ of this account may create invites; a non-member/under-tier is 403.
  if (!authorize(req, reply, body.accountId, "manageInvites")) return;
  const requestedExpiry = body.expiresAt;
  let expiresAt: string | null;
  if (requestedExpiry === undefined) {
    // Null is canonical across retries. The account-administration port chooses the standard
    // bounded expiry only on first execution, so an idempotent retry cannot drift with wall time.
    expiresAt = null;
  } else {
    const parsed = typeof requestedExpiry === "string" ? parseStrictIsoInstant(requestedExpiry) : null;
    if (parsed === null) {
      return accountFail(reply, validationFailed("expiresAt must be a valid ISO-8601 timestamp."));
    }
    expiresAt = new Date(parsed).toISOString();
  }
  try {
    const invite = await accountAdminPort.createInvitation({
      actor: req.accountActor!,
      workspaceId: body.accountId,
      role: body.role,
      preauthorizedEmail: preauthEmail,
      expiresAt,
      command: accountCommand(req),
    });
    auditUnlessReplayed(reply, invite, {
      ts: invite.createdAt,
      userId: req.user!.id,
      accountId: invite.workspaceId,
      action: "inviteCreate",
      entity: "invite",
      id: invite.id,
      changedFields: ["role", "preauthEmail", "expiresAt"],
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
  } catch (err) {
    return accountFail(reply, err);
  }
}

export async function previewInvitation(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const { administration: accountAdminPort, fail: accountFail } = ctx;

  const { token } = req.params as { token: string };
  try {
    const invite = await accountAdminPort.previewInvitation({ token });
    return {
      accountName: invite.workspaceName,
      role: invite.role,
      expiresAt: invite.expiresAt,
    };
  } catch (err) {
    return accountFail(reply, err);
  }
}

export async function acceptInvitation(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const {
    authMode,
    requiredSsoProviderId,
    administration: accountAdminPort,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
  } = ctx;

  const { token } = req.params as { token: string };
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
            principalId: req.accountActor!.principalId,
            principalEmail: req.user!.email,
            emailVerified: true,
            passwordMode: false,
            command: accountCommand(req),
          })
        : await accountAdminPort.acceptInvitation({
            actor: req.accountActor!,
            token,
            principalEmail: req.user!.email,
            emailVerified: req.user!.emailVerified,
            command: accountCommand(req),
          });
    const now = new Date().toISOString();
    auditUnlessReplayed(reply, accepted, {
      ts: now,
      userId: req.user!.id,
      accountId: accepted.workspaceId,
      action: "inviteAccept",
      entity: "membership",
      id: req.user!.id,
      changedFields: ["role"],
    });
    return reply.code(200).send({ accountId: accepted.workspaceId, role: accepted.role });
  } catch (err) {
    return accountFail(reply, err);
  }
}

export async function signupInvitation(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const {
    authMode,
    authenticationConfigured,
    flows: accountFlows,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
  } = ctx;

  if (authMode !== "password" || !authenticationConfigured) {
    return reply.code(404).send({ error: "Not found." });
  }
  const { token } = req.params as { token: string };
  const body = (req.body ?? {}) as {
    email?: unknown;
    name?: unknown;
    password?: unknown;
  };
  const email = typeof body.email === "string" ? normalizeAccountEmail(body.email) : "";
  if (!isAccountEmail(email)) {
    return reply.code(400).send({ error: "A valid email address is required." });
  }
  const name = typeof body.name === "string" ? cleanText(body.name) : "";
  if (name.length === 0) {
    return reply.code(400).send({ error: "Name is required." });
  }
  if (typeof body.password !== "string" || passwordLengthFailure(body.password)) {
    return reply.code(400).send({
      error: `Password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters.`,
    });
  }
  try {
    const result = await accountFlows!.acceptInviteWithPasswordSignup({
      token,
      email,
      displayName: name,
      password: body.password,
      command: accountCommand(req),
    });
    auditUnlessReplayed(reply, result, {
      ts: new Date().toISOString(),
      userId: result.principalId,
      accountId: result.membership.workspaceId,
      action: "inviteAccept",
      entity: "member",
      id: result.principalId,
      changedFields: ["role", "status"],
    });
    return reply.code(201).send({
      ok: true,
      accountId: result.membership.workspaceId,
      role: result.membership.role,
    });
  } catch (err) {
    return accountFail(reply, err);
  }
}

export async function listInvitations(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const { authMode, administration: accountAdminPort, authorize, fail: accountFail } = ctx;

  const { accountId } = req.params as { accountId: string };
  if (!authorize(req, reply, accountId, "manageInvites")) return;
  if (authMode === "off") return { invites: [] };
  try {
    const invites = await accountAdminPort.listInvitations({
      actor: req.accountActor!,
      workspaceId: accountId,
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
  } catch (err) {
    return accountFail(reply, err);
  }
}

export async function revokeInvitation(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const {
    administration: accountAdminPort,
    authorize,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
  } = ctx;

  const { accountId, id } = req.params as { accountId: string; id: string };
  if (!authorize(req, reply, accountId, "manageInvites")) return;
  try {
    const revoked = await accountAdminPort.revokeInvitation({
      actor: req.accountActor!,
      workspaceId: accountId,
      invitationId: id,
      command: accountCommand(req),
    });
    auditUnlessReplayed(
      reply,
      revoked,
      {
        ts: new Date().toISOString(),
        userId: req.user!.id,
        accountId,
        action: "inviteRevoke",
        entity: "invite",
        id,
        changedFields: [],
      },
      revoked.changed,
    );
    return reply.code(204).send();
  } catch (err) {
    return accountFail(reply, err);
  }
}
