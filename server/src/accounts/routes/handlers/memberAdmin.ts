import { AccountContractError } from "@capacitylens/shared/account/errors";
import { isMembershipStatus } from "@capacitylens/shared/account/types";
import type { FastifyReply, FastifyRequest } from "fastify";
import { INVALID_ROLE_MESSAGE } from "../accountRouteDependencies";
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
  if (!authorize({ req, reply, accountId, action: "manageMembers", options: { requireFreshSession: false } })) return;
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
    const members = directory.map(({ membership: member, principal }) => {
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
      };
    });
    return { members, signInTrackingEnabled: tracking.enabled };
  } catch (error) {
    return accountFail(reply, error);
  }
}

export async function setMemberSignInTracking(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const { memberSignInTracking, authorize, audit, fail: accountFail } = context;

  const { accountId } = req.params as { accountId: string };
  if (!authorize({ req, reply, accountId, action: "manageMemberSignInTracking" })) return;
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
  if (!authorizeMemberMutation({ req, reply, accountId, action: "manageMembers" })) return;
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
  if (!authorizeMemberMutation({ req, reply, accountId, action: "manageMembers" })) return;
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
  if (!authorizeMemberMutation({ req, reply, accountId, action: "manageMembers" })) return;
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

export async function transferOwnership(req: FastifyRequest, reply: FastifyReply, context: AccountRouteContext) {
  const {
    administration: accountAdminPort,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
    authorizeMemberMutation,
  } = context;

  const { accountId } = req.params as { accountId: string };
  const body = (req.body ?? {}) as { toUserId?: unknown };
  if (typeof body.toUserId !== "string" || body.toUserId.length === 0) {
    return reply.code(400).send({ error: "toUserId must be a non-empty string." });
  }
  const toUserId = body.toUserId;
  if (!authorizeMemberMutation({ req, reply, accountId, action: "transferOwnership" })) return;
  try {
    const { actor, user } = requireAuthenticatedPrincipal(req);
    const now = new Date().toISOString();
    const transferred = await accountAdminPort.transferOwnership({
      actor,
      workspaceId: accountId,
      targetPrincipalId: toUserId,
      command: accountCommand(req),
    });
    auditUnlessReplayed({
      reply,
      result: transferred,
      record: {
        ts: now,
        userId: user.id,
        accountId,
        action: "ownershipTransfer",
        entity: "membership",
        id: toUserId,
        changedFields: ["role"],
      },
    });
    return reply.code(200).send({ toUserId, role: "owner" });
  } catch (error) {
    return accountFail(reply, error);
  }
}
