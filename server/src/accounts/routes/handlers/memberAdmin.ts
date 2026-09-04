import { isMembershipStatus } from "@capacitylens/shared/account/types";
import type { FastifyReply, FastifyRequest } from "fastify";
import { INVALID_ROLE_MESSAGE } from "../accountRouteDependencies";
import type { AccountRouteContext } from "../replyHelpers";

export async function listMembers(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const {
    authMode,
    flows: accountFlows,
    memberSignInTracking,
    authorize,
    fail: accountFail,
    memberReadProjection,
  } = ctx;

  const { accountId } = req.params as { accountId: string };
  if (!authorize(req, reply, accountId, "manageMembers")) return;
  // OFF mode: no real member model (req.user is DEMO_USER, membership is unread) — return empty so
  // the shape is honest and nothing crashes. The UI is hidden in OFF, so this is belt-and-braces.
  if (authMode === "off") return { members: [], signInTrackingEnabled: false };
  try {
    const tracking = memberSignInTracking.snapshot(accountId);
    const directory = await accountFlows!.listMemberDirectory({
      actor: req.accountActor!,
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
  } catch (err) {
    return accountFail(reply, err);
  }
}

export async function setMemberSignInTracking(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const { memberSignInTracking, authorize, audit, fail: accountFail } = ctx;

  const { accountId } = req.params as { accountId: string };
  if (!authorize(req, reply, accountId, "manageMemberSignInTracking")) return;
  const body = req.body as { enabled?: unknown } | null;
  if (!body || typeof body.enabled !== "boolean") {
    return reply.code(400).send({ error: "enabled must be a boolean." });
  }
  try {
    const result = memberSignInTracking.set(accountId, req.accountActor!.principalId, body.enabled);
    if (result.changed) {
      audit(reply, {
        ts: new Date().toISOString(),
        userId: req.accountActor!.principalId,
        accountId,
        action: "memberSignInTrackingChange",
        entity: "account",
        id: accountId,
        changedFields: ["memberSignInTracking"],
      });
    }
    return reply.code(200).send({ enabled: result.enabled });
  } catch (err) {
    return accountFail(reply, err);
  }
}

export async function changeMemberRole(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const {
    administration: accountAdminPort,
    command: accountCommand,
    fail: accountFail,
    isKnownRole,
    auditUnlessReplayed,
    authorizeMemberMutation,
  } = ctx;

  const { accountId, userId } = req.params as {
    accountId: string;
    userId: string;
  };
  const body = (req.body ?? {}) as { role?: unknown };
  if (!isKnownRole(body.role)) {
    return reply.code(400).send({ error: INVALID_ROLE_MESSAGE });
  }
  const nextRole = body.role;
  if (!authorizeMemberMutation(req, reply, accountId, "manageMembers")) return;
  try {
    const changed = await accountAdminPort.changeMemberRole({
      actor: req.accountActor!,
      workspaceId: accountId,
      targetPrincipalId: userId,
      nextRole,
      command: accountCommand(req),
    });
    auditUnlessReplayed(reply, changed, {
      ts: new Date().toISOString(),
      userId: req.user!.id,
      accountId,
      action: "memberRole",
      entity: "membership",
      id: userId,
      changedFields: ["role"],
    });
    return reply.code(200).send({ userId: changed.principalId, role: changed.role });
  } catch (err) {
    return accountFail(reply, err);
  }
}

export async function changeMemberStatus(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const {
    administration: accountAdminPort,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
    authorizeMemberMutation,
  } = ctx;

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
  if (!authorizeMemberMutation(req, reply, accountId, "manageMembers")) return;
  try {
    const changed = await accountAdminPort.changeMemberStatus({
      actor: req.accountActor!,
      workspaceId: accountId,
      targetPrincipalId: userId,
      nextStatus,
      command: accountCommand(req),
    });
    auditUnlessReplayed(reply, changed, {
      ts: new Date().toISOString(),
      userId: req.user!.id,
      accountId,
      action: "memberStatus",
      entity: "membership",
      id: userId,
      changedFields: ["status"],
    });
    return reply.code(200).send({ userId: changed.principalId, status: changed.status });
  } catch (err) {
    return accountFail(reply, err);
  }
}

export async function removeMember(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const {
    administration: accountAdminPort,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
    authorizeMemberMutation,
  } = ctx;

  const { accountId, userId } = req.params as {
    accountId: string;
    userId: string;
  };
  if (!authorizeMemberMutation(req, reply, accountId, "manageMembers")) return;
  try {
    const removed = await accountAdminPort.removeMember({
      actor: req.accountActor!,
      workspaceId: accountId,
      targetPrincipalId: userId,
      command: accountCommand(req),
    });
    auditUnlessReplayed(reply, removed, {
      ts: new Date().toISOString(),
      userId: req.user!.id,
      accountId,
      action: "memberRemove",
      entity: "membership",
      id: userId,
      changedFields: [],
    });
    return reply.code(204).send();
  } catch (err) {
    return accountFail(reply, err);
  }
}

export async function transferOwnership(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const {
    administration: accountAdminPort,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
    authorizeMemberMutation,
  } = ctx;

  const { accountId } = req.params as { accountId: string };
  const body = (req.body ?? {}) as { toUserId?: unknown };
  if (typeof body.toUserId !== "string" || body.toUserId.length === 0) {
    return reply.code(400).send({ error: "toUserId must be a non-empty string." });
  }
  const toUserId = body.toUserId;
  if (!authorizeMemberMutation(req, reply, accountId, "transferOwnership")) return;
  try {
    const now = new Date().toISOString();
    const transferred = await accountAdminPort.transferOwnership({
      actor: req.accountActor!,
      workspaceId: accountId,
      targetPrincipalId: toUserId,
      command: accountCommand(req),
    });
    auditUnlessReplayed(reply, transferred, {
      ts: now,
      userId: req.user!.id,
      accountId,
      action: "ownershipTransfer",
      entity: "membership",
      id: toUserId,
      changedFields: ["role"],
    });
    return reply.code(200).send({ toUserId, role: "owner" });
  } catch (err) {
    return accountFail(reply, err);
  }
}
