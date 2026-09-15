import { isMembershipStatus } from "@capacitylens/shared/account/types";
import type { FastifyReply, FastifyRequest } from "fastify";
import { INVALID_ROLE_MESSAGE } from "../accountRouteDependencies";
import { NO_REPROMPT } from "../../../routes/routeShared";
import type { AccountRouteContext } from "../createReplyHelpers";
import { requireAccountActor, requireAuthenticatedPrincipal } from "./authenticatedPrincipal";
import { AccountContractError } from "@capacitylens/shared/account/errors";

function projectMemberResourceLink(
  link:
    { resourceId: string; revision: string; resourceName?: string | null; resourceStatus?: string | null } | undefined,
) {
  return link
    ? {
        resourceId: link.resourceId,
        revision: link.revision,
        resourceName: link.resourceName ?? null,
        resourceStatus: link.resourceStatus ?? null,
      }
    : null;
}

export async function listMembers(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const {
    authMode,
    flows: accountFlows,
    memberSignInTracking,
    authorize,
    fail: accountFail,
    memberReadProjection,
  } = context;

  const { accountId } = req.params as { accountId: string };
  if (!authorize({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT })) return;
  // OFF mode: no real member model (req.user is DEMO_USER, membership is unread) — return empty so
  // the shape is honest and nothing crashes. The UI is hidden in OFF, so this is belt-and-braces.
  if (authMode === "off") return { members: [], signInTrackingEnabled: false };
  try {
    const actor = requireAccountActor(req);
    const tracking = memberSignInTracking.snapshot(accountId);
    const directory = await accountFlows.listMemberDirectory({
      actor,
      workspaceId: accountId,
    });
    const projection = memberReadProjection(
      req,
      accountId,
      directory.map(({ membership }) => membership.principalId),
    );
    const links = await context.memberResources.listLinks(accountId);
    const exceptions = await context.memberResources.listExceptions(accountId);
    const resourceCandidates = await context.memberResources.listCandidates(accountId);
    const members = directory.map(({ membership: member, principal }) => {
      const link = links.get(member.principalId);
      return {
        userId: member.principalId,
        role: member.role,
        status: member.status,
        createdAt: member.joinedAt,
        name: principal?.displayName ?? null,
        email: principal?.email ?? null,
        signInConfirmed: tracking.enabled ? (tracking.confirmations.get(member.principalId) ?? false) : null,
        isSelf: member.principalId === projection.principalId,
        mayResetPassword:
          authMode === "password" &&
          projection.decisions.get(member.principalId)?.get("issue-password-reset")?.allowed === true,
        mayRevokeSessions: projection.decisions.get(member.principalId)?.get("revoke-sessions")?.allowed === true,
        resourceLink: projectMemberResourceLink(link),
        resourceLinkException: (() => {
          const exception = exceptions.get(member.principalId);
          return exception === undefined
            ? null
            : { proposedResourceId: exception.proposedResourceId, reason: exception.reason };
        })(),
      };
    });
    return { members, signInTrackingEnabled: tracking.enabled, resourceCandidates };
  } catch (error) {
    return accountFail(reply, error);
  }
}

function linkFailure(error: unknown): never {
  if (error instanceof Error && error.name === "AccountMemberResourceConflict") {
    throw new AccountContractError({ code: "CONFLICT", message: error.message, retryable: false }, { cause: error });
  }
  throw error;
}

/** Serve the authorized, privacy-minimal scheduled-person avatar projection for one account. */
export async function listResourceAvatars(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const { accountId } = req.params as { accountId: string };
  if (!context.authorize({ req, reply, accountId, action: "read", options: NO_REPROMPT })) return;
  if (context.authMode === "off") return { avatars: [] };
  try {
    return { avatars: await context.memberResources.listAvatarProjection(accountId) };
  } catch (error) {
    return context.fail(reply, error);
  }
}

/** Create, retry, or change one member/person association under opaque revision CAS. */
// eslint-disable-next-line complexity
export async function setMemberResourceLink(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const { accountId, userId } = req.params as { accountId: string; userId: string };
  if (!context.authorizeMemberMutation({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT }))
    return;
  const body = req.body as Record<string, unknown> | null;
  if (
    !body ||
    typeof body.resourceId !== "string" ||
    body.resourceId.length === 0 ||
    !(body.expectedRevision === null || typeof body.expectedRevision === "string") ||
    (body.replacePrincipalId !== undefined &&
      (typeof body.replacePrincipalId !== "string" || body.replacePrincipalId.length === 0)) ||
    (body.replaceExpectedRevision !== undefined &&
      (typeof body.replaceExpectedRevision !== "string" || body.replaceExpectedRevision.length === 0)) ||
    (body.replacePrincipalId === undefined) !== (body.replaceExpectedRevision === undefined)
  ) {
    return context.fail(reply, context.validationFailed("resourceId and expectedRevision are required."));
  }
  try {
    const actor = requireAccountActor(req);
    const link = await context.memberResources.setLink({
      workspaceId: accountId,
      principalId: userId,
      resourceId: body.resourceId,
      expectedRevision: body.expectedRevision,
      ...(typeof body.replacePrincipalId === "string" ? { replacePrincipalId: body.replacePrincipalId } : {}),
      ...(typeof body.replaceExpectedRevision === "string"
        ? { replaceExpectedRevision: body.replaceExpectedRevision }
        : {}),
      now: new Date().toISOString(),
      actor,
      command: context.command(req),
    });
    return reply.code(200).send({ resourceId: link.resourceId, revision: link.revision });
  } catch (error) {
    try {
      linkFailure(error);
    } catch (failure) {
      return context.fail(reply, failure);
    }
  }
}

/** Remove one member/person association only when its opaque revision still matches. */
export async function clearMemberResourceLink(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const { accountId, userId } = req.params as { accountId: string; userId: string };
  if (!context.authorizeMemberMutation({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT }))
    return;
  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body.expectedRevision !== "string" || body.expectedRevision.length === 0) {
    return context.fail(reply, context.validationFailed("expectedRevision is required."));
  }
  try {
    const actor = requireAccountActor(req);
    await context.memberResources.clearLink({
      workspaceId: accountId,
      principalId: userId,
      expectedRevision: body.expectedRevision,
      actor,
      command: context.command(req),
    });
    return reply.code(204).send();
  } catch (error) {
    try {
      linkFailure(error);
    } catch (failure) {
      return context.fail(reply, failure);
    }
  }
}

/** Dismiss the current proposal exception without changing a live member/person link. */
export async function dismissMemberResourceLinkException(
  req: FastifyRequest,
  reply: FastifyReply,
  context: AccountRouteContext,
) {
  const { accountId, userId } = req.params as { accountId: string; userId: string };
  if (!context.authorizeMemberMutation({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT }))
    return;
  try {
    await context.memberResources.dismissException({
      workspaceId: accountId,
      principalId: userId,
      actor: requireAccountActor(req),
      command: context.command(req),
    });
    return reply.code(204).send();
  } catch (error) {
    return context.fail(reply, error);
  }
}

export async function setMemberSignInTracking(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const { memberSignInTracking, authorize, audit, fail: accountFail } = context;

  const { accountId } = req.params as { accountId: string };
  if (!authorize({ req, reply, accountId, action: "manageMemberSignInTracking", options: NO_REPROMPT })) return;
  const body = req.body as { enabled?: unknown } | null;
  if (!body || typeof body.enabled !== "boolean") {
    return reply.code(400).send({ error: "enabled must be a boolean." });
  }
  try {
    const actor = requireAccountActor(req);
    const result = memberSignInTracking.set({
      workspaceId: accountId,
      actorPrincipalId: actor.principalId,
      enabled: body.enabled,
    });
    if (result.changed) {
      audit(reply, {
        ts: new Date().toISOString(),
        userId: actor.principalId,
        accountId,
        action: "memberSignInTrackingChange",
        entity: "account",
        id: accountId,
        changedFields: ["memberSignInTracking"],
      });
    }
    return reply.code(200).send({ enabled: result.enabled });
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function changeMemberRole(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const {
    administration: accountAdminPort,
    command: accountCommand,
    fail: accountFail,
    isKnownRole,
    auditUnlessReplayed,
    authorizeMemberMutation,
  } = context;

  const { accountId, userId } = req.params as {
    accountId: string;
    userId: string;
  };
  const body = (req.body ?? {}) as { role?: unknown };
  if (!isKnownRole(body.role)) {
    return reply.code(400).send({ error: INVALID_ROLE_MESSAGE });
  }
  const nextRole = body.role;
  if (!authorizeMemberMutation({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT })) return;
  try {
    const { actor, user } = requireAuthenticatedPrincipal(req);
    const changed = await accountAdminPort.changeMemberRole({
      actor,
      workspaceId: accountId,
      targetPrincipalId: userId,
      nextRole,
      command: accountCommand(req),
    });
    auditUnlessReplayed({
      reply,
      result: changed,
      record: {
        ts: new Date().toISOString(),
        userId: user.id,
        accountId,
        action: "memberRole",
        entity: "membership",
        id: userId,
        changedFields: ["role"],
      },
    });
    return reply.code(200).send({ userId: changed.principalId, role: changed.role });
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function changeMemberStatus(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const {
    administration: accountAdminPort,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
    authorizeMemberMutation,
  } = context;

  const { accountId, userId } = req.params as {
    accountId: string;
    userId: string;
  };
  const body = (req.body ?? {}) as { status?: unknown };
  if (!isMembershipStatus(body.status)) {
    return reply.code(400).send({
      error: "status must be one of active, disabled, archived.",
    });
  }
  const nextStatus = body.status;
  if (!authorizeMemberMutation({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT })) return;
  try {
    const { actor, user } = requireAuthenticatedPrincipal(req);
    const changed = await accountAdminPort.changeMemberStatus({
      actor,
      workspaceId: accountId,
      targetPrincipalId: userId,
      nextStatus,
      command: accountCommand(req),
    });
    auditUnlessReplayed({
      reply,
      result: changed,
      record: {
        ts: new Date().toISOString(),
        userId: user.id,
        accountId,
        action: "memberStatus",
        entity: "membership",
        id: userId,
        changedFields: ["status"],
      },
    });
    return reply.code(200).send({ userId: changed.principalId, status: changed.status });
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function removeMember(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const {
    administration: accountAdminPort,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
    authorizeMemberMutation,
  } = context;

  const { accountId, userId } = req.params as {
    accountId: string;
    userId: string;
  };
  if (!authorizeMemberMutation({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT })) return;
  try {
    const { actor, user } = requireAuthenticatedPrincipal(req);
    const removed = await accountAdminPort.removeMember({
      actor,
      workspaceId: accountId,
      targetPrincipalId: userId,
      command: accountCommand(req),
    });
    auditUnlessReplayed({
      reply,
      result: removed,
      record: {
        ts: new Date().toISOString(),
        userId: user.id,
        accountId,
        action: "memberRemove",
        entity: "membership",
        id: userId,
        changedFields: [],
      },
    });
    return reply.code(204).send();
  } catch (error) {
    return accountFail(reply, error);
  }
}
