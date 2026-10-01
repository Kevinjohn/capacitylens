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
    // 'sso': the IdP owns sign-in, resetting a local password is meaningless there. 'off':
    // trusted-local, no credential model (and no UI shows the button), a clear 400 either way.
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
    return accountFail(reply, error);
  }
}
