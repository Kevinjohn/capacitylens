import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import type { FastifyReply, FastifyRequest } from "fastify";
import { REPLY_ERRORS } from "../../../routes/replyErrors";
import type { MemberRoute } from "../accountRouteDependencies";
import type { AccountRouteContext } from "../createReplyHelpers";

function assertAuthenticatedRequestContext(req: FastifyRequest) {
  const actor = req.accountActor;
  const user = req.user;
  if (!actor || !user) throw new Error("Expected authenticated context on a credential administration route.");
  return { actor, userId: user.id };
}

type ResetPasswordContext = Pick<
  AccountRouteContext,
  "auditUnlessReplayed" | "authMode" | "authorize" | "command" | "fail" | "flows" | "requireMembership"
>;

/** Issues a reset ceremony for an authorized member, including the caller when permitted. */
export async function resetPassword(
  req: FastifyRequest<MemberRoute>,
  reply: FastifyReply,
  context: ResetPasswordContext,
) {
  const {
    authMode,
    flows: accountFlows,
    authorize,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
    requireMembership,
  } = context;

  const { accountId, userId } = req.params;
  if (!authorize({ req, reply, accountId, action: "manageMembers" })) return;
  if (!allowsPasswordSignIn(authMode)) {
    // Password reset is unavailable when the configured mode does not support password sign-in.
    return reply.code(400).send({
      error: REPLY_ERRORS.passwordResetUnavailable,
    });
  }
  try {
    const command = accountCommand(req);
    const targetMembership = await requireMembership({ reply, accountId, userId, command });
    if (!targetMembership) return;
    const { actor, userId: actorUserId } = assertAuthenticatedRequestContext(req);
    const ceremony = await accountFlows.issuePasswordReset({
      actor,
      targetPrincipalId: userId,
      command,
    });
    auditUnlessReplayed({
      reply,
      result: ceremony,
      record: {
        ts: new Date().toISOString(),
        userId: actorUserId,
        accountId,
        action: "passwordResetIssue",
        entity: "identity",
        id: userId,
        changedFields: ["credential"],
      },
    });
    return reply.code(201).send({ token: ceremony.token, expiresAt: ceremony.expiresAt });
  } catch (error) {
    // Surface the failure through the account response boundary so callers receive the mapped status and safe error shape.
    return accountFail(reply, error);
  }
}

type RevokeMemberSessionsContext = Pick<
  AccountRouteContext,
  | "auditUnlessReplayed"
  | "authMode"
  | "authenticationConfigured"
  | "authorize"
  | "command"
  | "fail"
  | "flows"
  | "requireMembership"
>;

/** Revokes the target member’s sessions after identity-global authority and freshness checks. */
export async function revokeMemberSessions(
  req: FastifyRequest<MemberRoute>,
  reply: FastifyReply,
  context: RevokeMemberSessionsContext,
) {
  const {
    authMode,
    authenticationConfigured,
    flows: accountFlows,
    authorize,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
    requireMembership,
  } = context;

  const { accountId, userId } = req.params;
  if (!authorize({ req, reply, accountId, action: "manageMembers" })) return;
  if (authMode === "off" || !authenticationConfigured) {
    return reply.code(400).send({ error: REPLY_ERRORS.sessionsRequireAuthentication });
  }
  try {
    const command = accountCommand(req);
    const targetMembership = await requireMembership({ reply, accountId, userId, command });
    if (!targetMembership) return;
    const { actor, userId: actorUserId } = assertAuthenticatedRequestContext(req);
    const revoked = await accountFlows.revokeMemberSessions({
      actor,
      targetPrincipalId: userId,
      command,
    });
    auditUnlessReplayed({
      reply,
      result: revoked,
      record: {
        ts: new Date().toISOString(),
        userId: actorUserId,
        accountId,
        action: "sessionsRevoke",
        entity: "identity",
        id: userId,
        changedFields: ["sessions"],
      },
    });
    return reply.code(204).send();
  } catch (error) {
    // Surface the failure through the account response boundary so callers receive the mapped status and safe error shape.
    return accountFail(reply, error);
  }
}
