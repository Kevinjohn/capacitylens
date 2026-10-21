import type { MembershipStatus, Role } from "@capacitylens/shared/account/types";
import { isMembershipStatus } from "@capacitylens/shared/account/types";
import type { FastifyReply, FastifyRequest } from "fastify";
import { REPLY_ERRORS } from "../../../routes/replyErrors";
import { NO_REPROMPT } from "../../../routes/routeShared";
import type { ParseResult } from "../../../routes/routeShared";
import type { MemberRoute } from "../accountRouteDependencies";
import type { AccountRouteContext } from "../createReplyHelpers";
import { requireAuthenticatedPrincipal } from "./authenticatedPrincipal";

type MemberMutationContext = Pick<
  AccountRouteContext,
  "administration" | "auditUnlessReplayed" | "authorizeMemberMutation" | "command" | "fail" | "isKnownRole"
>;

function parseRole(value: unknown, isKnownRole: MemberMutationContext["isKnownRole"]): ParseResult<Role, string> {
  const { role } = (value ?? {}) as { role?: unknown };
  return isKnownRole(role) ? { kind: "parsed", value: role } : { kind: "invalid", failure: REPLY_ERRORS.invalidRole };
}

function parseMembershipStatus(value: unknown): ParseResult<MembershipStatus, string> {
  const { status } = (value ?? {}) as { status?: unknown };
  return isMembershipStatus(status)
    ? { kind: "parsed", value: status }
    : { kind: "invalid", failure: REPLY_ERRORS.memberStatusInvalid };
}

/**
 * Changes a member’s role after checking the caller’s authority and target.
 */
export async function changeMemberRole(
  req: FastifyRequest<MemberRoute>,
  reply: FastifyReply,
  context: MemberMutationContext,
) {
  const {
    administration: accountAdminPort,
    command: accountCommand,
    fail: accountFail,
    isKnownRole,
    auditUnlessReplayed,
    authorizeMemberMutation,
  } = context;

  const { accountId, userId } = req.params;
  const parsed = parseRole(req.body, isKnownRole);
  if (parsed.kind === "invalid") return reply.code(400).send({ error: parsed.failure });
  const nextRole = parsed.value;
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
    // Surface the failure through the account response boundary so callers receive the mapped status and safe error shape.
    return accountFail(reply, error);
  }
}

/**
 * Changes a member’s active, disabled, or archived state after authorization.
 */
export async function changeMemberStatus(
  req: FastifyRequest<MemberRoute>,
  reply: FastifyReply,
  context: MemberMutationContext,
) {
  const {
    administration: accountAdminPort,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
    authorizeMemberMutation,
  } = context;

  const { accountId, userId } = req.params;
  const parsed = parseMembershipStatus(req.body);
  if (parsed.kind === "invalid") return reply.code(400).send({ error: parsed.failure });
  const nextStatus = parsed.value;
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
    return reply
      .code(200)
      .send({ userId: changed.principalId, status: nextStatus, accessDisabled: changed.accessDisabled === true });
  } catch (error) {
    // Surface the failure through the account response boundary so callers receive the mapped status and safe error shape.
    return accountFail(reply, error);
  }
}

/**
 * Restores a member’s access after authorization and membership checks.
 */
export async function enableMemberAccess(
  req: FastifyRequest<MemberRoute>,
  reply: FastifyReply,
  context: MemberMutationContext,
) {
  const { accountId, userId } = req.params;
  if (!context.authorizeMemberMutation({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT }))
    return;
  try {
    const { actor, user } = requireAuthenticatedPrincipal(req);
    const changed = await context.administration.enableMemberAccess({
      actor,
      workspaceId: accountId,
      targetPrincipalId: userId,
      command: context.command(req),
    });
    context.auditUnlessReplayed({
      reply,
      result: changed,
      record: {
        ts: new Date().toISOString(),
        userId: user.id,
        accountId,
        action: "memberAccessEnabled",
        entity: "membership",
        id: userId,
        changedFields: ["accessRestriction"],
      },
    });
    return reply.code(200).send({ userId, accessDisabled: changed.accessDisabled === true });
  } catch (error) {
    // Surface the failure through the account response boundary so callers receive the mapped status and safe error shape.
    return context.fail(reply, error);
  }
}

/**
 * Removes the member and its dependent account records through the administration port.
 */
export async function removeMember(
  req: FastifyRequest<MemberRoute>,
  reply: FastifyReply,
  context: MemberMutationContext,
) {
  const {
    administration: accountAdminPort,
    command: accountCommand,
    fail: accountFail,
    auditUnlessReplayed,
    authorizeMemberMutation,
  } = context;

  const { accountId, userId } = req.params;
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
    // Surface the failure through the account response boundary so callers receive the mapped status and safe error shape.
    return accountFail(reply, error);
  }
}
