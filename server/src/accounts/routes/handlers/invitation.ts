import { resolveMailDeliveryCause } from "../../../authConfig/mailSender";
import { wasAccountCommandReplayed } from "../../commands";
import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { FastifyReply, FastifyRequest } from "fastify";
import { NO_REPROMPT } from "../../../routes/routeShared";
import { parseCreateInvitationAuthorizationInput, parseInvitationExpiry } from "./invitationCreateInput";
import { parseSignupInvitationInput } from "./invitationSignupInput";
import type { AccountRouteContext } from "../createReplyHelpers";
import {
  createAuthenticationRequiredError,
  requireAccountActor,
  requireAuthenticatedPrincipal,
} from "./authenticatedPrincipal";

const trustedLocalProposalFailure = () =>
  new AccountContractError({ code: "FORBIDDEN", message: "Forbidden.", retryable: false });

/** The account-route members the invitation handlers read. */
type InvitationRouteContext = Pick<
  AccountRouteContext,
  | "administration"
  | "auditUnlessReplayed"
  | "authMode"
  | "authenticationConfigured"
  | "authorize"
  | "command"
  | "fail"
  | "flows"
  | "invitationMail"
  | "isKnownRole"
  | "permittedCompanyProviderIds"
  | "requiredSsoProviderId"
  | "validationFailed"
>;

export async function createInvitation(req: FastifyRequest, reply: FastifyReply, context: InvitationRouteContext) {
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
  if (input.kind === "invalid") return accountFail(reply, input.failure);
  const { value } = input;
  // Gate BEFORE any write: admin+ of this account may create invites; a non-member/under-tier is 403.
  if (!authorize({ req, reply, accountId: value.accountId, action: "manageInvites", options: NO_REPROMPT })) return;
  if (value.proposedResourceId === "")
    return accountFail(reply, createValidationFailure("proposedResourceId must be a non-empty string."));
  if (authMode === "off" && value.proposedResourceId !== undefined)
    return accountFail(reply, trustedLocalProposalFailure());
  const expiryResult = parseInvitationExpiry(value.requestedExpiry, createValidationFailure);
  if (expiryResult.kind === "invalid") return accountFail(reply, expiryResult.failure);
  try {
    const { actor, user } = requireAuthenticatedPrincipal(req);
    const invite = await accountAdminPort.createInvitation({
      actor,
      workspaceId: value.accountId,
      role: value.role,
      preauthorizedEmail: value.preauthEmail,
      // Null is canonical across retries; the port chooses the bounded default only on first execution.
      expiresAt: expiryResult.value,
      ...(value.proposedResourceId === undefined ? {} : { proposedResourceId: value.proposedResourceId }),
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
        changedFields: ["role", "preauthEmail", "expiresAt", "proposedResourceId"],
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
      emailed: await sendInvitationEmail({ req, context, invite }),
      ...(invite.proposedResourceId === undefined ? {} : { proposedResourceId: invite.proposedResourceId }),
    });
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function previewInvitation(req: FastifyRequest, reply: FastifyReply, context: InvitationRouteContext) {
  const { administration: accountAdminPort, fail: accountFail } = context;

  const { token } = req.params as { token: string };
  try {
    const invite = await accountAdminPort.previewInvitation({ token });
    return {
      accountId: invite.workspaceId,
      accountName: invite.workspaceName,
      role: invite.role,
      expiresAt: invite.expiresAt,
      emailBound: invite.emailBound,
      emailHint: invite.emailHint,
    };
  } catch (error) {
    return accountFail(reply, error);
  }
}

function permitsInvitationProvider(req: FastifyRequest, context: InvitationRouteContext): boolean {
  if (context.authMode !== "sso-only") return true;
  const providerId = req.authenticationProviderId;
  return (
    providerId !== null &&
    (context.permittedCompanyProviderIds?.has(providerId) ?? providerId === context.requiredSsoProviderId)
  );
}

export async function acceptInvitation(req: FastifyRequest, reply: FastifyReply, context: InvitationRouteContext) {
  const {
    authMode,
    administration: accountAdminPort,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
  } = context;

  const { token } = req.params as { token: string };
  const { accountActor: actor, user } = req;
  if (!actor || !user) return accountFail(reply, createAuthenticationRequiredError());
  try {
    if (!permitsInvitationProvider(req, context)) {
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

export async function signupInvitation(req: FastifyRequest, reply: FastifyReply, context: InvitationRouteContext) {
  const { authMode, authenticationConfigured, flows, command, fail, auditUnlessReplayed } = context;
  if (!allowsPasswordSignIn(authMode) || !authenticationConfigured) {
    return reply.code(404).send({ error: "Not found." });
  }
  const { token } = req.params as { token: string };
  const input = parseSignupInvitationInput(req);
  if ("failure" in input) return reply.code(400).send({ error: input.failure });
  try {
    const result = await flows.acceptInviteWithPasswordSignup({
      token,
      email: input.value.email,
      displayName: input.value.name,
      password: input.value.password,
      command: command(req),
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
    return reply.code(201).send({ ok: true, accountId: result.membership.workspaceId, role: result.membership.role });
  } catch (error) {
    return fail(reply, error);
  }
}

export async function listInvitations(req: FastifyRequest, reply: FastifyReply, context: InvitationRouteContext) {
  const { authMode, administration: accountAdminPort, authorize, fail: accountFail } = context;

  const { accountId } = req.params as { accountId: string };
  if (!authorize({ req, reply, accountId, action: "manageInvites", options: NO_REPROMPT })) return;
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
        ...(invite.proposedResourceId === undefined ? {} : { proposedResourceId: invite.proposedResourceId }),
        ...(invite.proposedResourceLabel === undefined ? {} : { proposedResourceLabel: invite.proposedResourceLabel }),
      })),
    };
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function revokeInvitation(req: FastifyRequest, reply: FastifyReply, context: InvitationRouteContext) {
  const {
    administration: accountAdminPort,
    authorize,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
  } = context;

  const { accountId, id } = req.params as { accountId: string; id: string };
  if (!authorize({ req, reply, accountId, action: "manageInvites", options: NO_REPROMPT })) return;
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

/** Delivery failure preserves the created invitation and its copyable link. */
async function sendInvitationEmail({
  req,
  context,
  invite,
}: {
  req: FastifyRequest;
  context: Pick<InvitationRouteContext, "invitationMail">;
  invite: Awaited<ReturnType<AccountRouteContext["administration"]["createInvitation"]>>;
}): Promise<boolean> {
  const mail = context.invitationMail;
  if (!mail || !invite.preauthorizedEmail || wasAccountCommandReplayed(invite)) return false;
  try {
    const link = new URL("/invite/" + encodeURIComponent(invite.token), mail.publicUrl);
    await mail.sender.send({
      accountId: invite.workspaceId,
      to: invite.preauthorizedEmail,
      subject: "Your invitation",
      text: `Open this link to accept your invitation: ${link.href}`,
    });
    return true;
  } catch (cause) {
    req.log.error({ cause: resolveMailDeliveryCause(cause) }, "Invitation email delivery failed");
    return false;
  }
}
