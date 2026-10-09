import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import type { MembershipStatus, Role } from "@capacitylens/shared/account/types";
import { isMembershipStatus } from "@capacitylens/shared/account/types";
import type { FastifyReply, FastifyRequest } from "fastify";
import { REPLY_ERRORS } from "../../../routes/replyErrors";
import { NO_REPROMPT } from "../../../routes/routeShared";
import type { ParseResult } from "../../../routes/routeShared";
import type { AccountRoute, MemberRoute } from "../accountRouteDependencies";
import type { AccountRouteContext } from "../createReplyHelpers";
import { requireAccountActor, requireAuthenticatedPrincipal } from "./authenticatedPrincipal";

type MemberMutationContext = Pick<
  AccountRouteContext,
  "administration" | "auditUnlessReplayed" | "authorizeMemberMutation" | "command" | "fail" | "isKnownRole"
>;

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

function parseEnabled(value: unknown): ParseResult<boolean, string> {
  const body = value as { enabled?: unknown } | null;
  if (!body || typeof body.enabled !== "boolean")
    return { kind: "invalid", failure: REPLY_ERRORS.memberEnabledInvalid };
  return { kind: "parsed", value: body.enabled };
}

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

type ListMembersContext = Pick<
  AccountRouteContext,
  "authMode" | "authorize" | "fail" | "flows" | "memberReadProjection" | "memberResources" | "memberSignInTracking"
>;

// This projection binds directory, resource and account-level permissions in one response.
// eslint-disable-next-line max-lines-per-function
export async function listMembers(req: FastifyRequest<AccountRoute>, reply: FastifyReply, context: ListMembersContext) {
  const {
    authMode,
    flows: accountFlows,
    memberSignInTracking,
    authorize,
    fail: accountFail,
    memberReadProjection,
  } = context;

  const { accountId } = req.params;
  if (!authorize({ req, reply, accountId, action: "manageMembers", options: NO_REPROMPT })) return;
  // Off mode: no real member model (req.user is DEMO_USER, membership is unread), return empty so
  // the shape is honest and nothing crashes. The UI is hidden in off, so this is belt-and-braces.
  if (authMode === "off") return reply.code(200).send({ members: [], signInTrackingEnabled: false });
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
    // eslint-disable-next-line complexity
    const members = directory.map(({ membership: member, principal }) => {
      const link = links.get(member.principalId);
      return {
        userId: member.principalId,
        role: member.role,
        status: member.status,
        accessDisabled: member.accessDisabled === true,
        membershipPresent: member.membershipPresent !== false,
        createdAt: member.joinedAt,
        name: principal?.displayName ?? null,
        email: principal?.email ?? member.restrictionEmail ?? null,
        signInConfirmed: tracking.enabled ? (tracking.confirmations.get(member.principalId) ?? false) : null,
        isSelf: member.principalId === projection.principalId,
        mayResetPassword:
          member.membershipPresent !== false &&
          allowsPasswordSignIn(authMode) &&
          projection.decisions.get(member.principalId)?.get("issue-password-reset")?.allowed === true,
        mayRevokeSessions:
          member.membershipPresent !== false &&
          projection.decisions.get(member.principalId)?.get("revoke-sessions")?.allowed === true,
        resourceLink: projectMemberResourceLink(link),
        resourceLinkException: (() => {
          const exception = exceptions.get(member.principalId);
          return exception === undefined
            ? null
            : { proposedResourceId: exception.proposedResourceId, reason: exception.reason };
        })(),
      };
    });
    return reply.code(200).send({ members, signInTrackingEnabled: tracking.enabled, resourceCandidates });
  } catch (error) {
    return accountFail(reply, error);
  }
}

/** Serve the authorized, privacy-minimal scheduled-person avatar projection for one account. */
export async function listResourceAvatars(
  req: FastifyRequest<AccountRoute>,
  reply: FastifyReply,
  context: Pick<AccountRouteContext, "authMode" | "authorize" | "fail" | "memberResources">,
) {
  const { accountId } = req.params;
  if (!context.authorize({ req, reply, accountId, action: "read", options: NO_REPROMPT })) return;
  if (context.authMode === "off") return reply.code(200).send({ avatars: [] });
  try {
    return reply.code(200).send({ avatars: await context.memberResources.listAvatarProjection(accountId) });
  } catch (error) {
    return context.fail(reply, error);
  }
}

export async function setMemberSignInTracking(
  req: FastifyRequest<AccountRoute>,
  reply: FastifyReply,
  context: Pick<AccountRouteContext, "audit" | "authorize" | "fail" | "memberSignInTracking">,
) {
  const { memberSignInTracking, authorize, audit, fail: accountFail } = context;

  const { accountId } = req.params;
  if (!authorize({ req, reply, accountId, action: "manageMemberSignInTracking", options: NO_REPROMPT })) return;
  const parsed = parseEnabled(req.body);
  if (parsed.kind === "invalid") return reply.code(400).send({ error: parsed.failure });
  try {
    const actor = requireAccountActor(req);
    const result = memberSignInTracking.set({
      workspaceId: accountId,
      actorPrincipalId: actor.principalId,
      enabled: parsed.value,
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
    return accountFail(reply, error);
  }
}

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
    return accountFail(reply, error);
  }
}

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
    return context.fail(reply, error);
  }
}

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
    return accountFail(reply, error);
  }
}
