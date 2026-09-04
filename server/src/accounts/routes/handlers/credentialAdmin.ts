import type { FastifyReply, FastifyRequest } from "fastify";
import type { AccountRouteContext } from "../replyHelpers";

export async function resetPassword(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const {
    authMode,
    flows: accountFlows,
    authorize,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
    requireMembership,
  } = ctx;

  const { accountId, userId } = req.params as {
    accountId: string;
    userId: string;
  };
  if (!authorize(req, reply, accountId, "manageMembers")) return;
  if (authMode !== "password") {
    // 'sso': the IdP owns sign-in — resetting a local password is meaningless there. 'off':
    // trusted-local, no credential model (and no UI shows the button) — a clear 400 either way.
    return reply.code(400).send({
      error: "Password reset links require a deployment profile with password sign-in enabled.",
    });
  }
  try {
    const command = accountCommand(req);
    const targetMembership = await requireMembership(reply, accountId, userId, command);
    if (!targetMembership) return;
    const ceremony = await accountFlows!.issuePasswordReset({
      actor: req.accountActor!,
      targetPrincipalId: userId,
      command,
    });
    auditUnlessReplayed(reply, ceremony, {
      ts: new Date().toISOString(),
      userId: req.user!.id,
      accountId,
      action: "passwordResetIssue",
      entity: "identity",
      id: userId,
      changedFields: ["credential"],
    });
    return reply.code(201).send({ token: ceremony.token, expiresAt: ceremony.expiresAt });
  } catch (err) {
    return accountFail(reply, err);
  }
}

export async function revokeMemberSessions(req: FastifyRequest, reply: FastifyReply, ctx: AccountRouteContext) {
  const {
    authMode,
    authenticationConfigured,
    flows: accountFlows,
    authorize,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
    requireMembership,
  } = ctx;

  const { accountId, userId } = req.params as {
    accountId: string;
    userId: string;
  };
  if (!authorize(req, reply, accountId, "manageMembers")) return;
  if (authMode === "off" || !authenticationConfigured) {
    return reply.code(400).send({ error: "Sessions require authentication." });
  }
  try {
    const command = accountCommand(req);
    const targetMembership = await requireMembership(reply, accountId, userId, command);
    if (!targetMembership) return;
    const revoked = await accountFlows!.revokeMemberSessions({
      actor: req.accountActor!,
      targetPrincipalId: userId,
      command,
    });
    auditUnlessReplayed(reply, revoked, {
      ts: new Date().toISOString(),
      userId: req.user!.id,
      accountId,
      action: "sessionsRevoke",
      entity: "identity",
      id: userId,
      changedFields: ["sessions"],
    });
    return reply.code(204).send();
  } catch (err) {
    return accountFail(reply, err);
  }
}
