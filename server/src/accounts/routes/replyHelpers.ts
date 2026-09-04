import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { CommandIdentity } from "@capacitylens/shared/account/types";
import { isAccountRole } from "@capacitylens/shared/account/types";
import type { Action } from "@capacitylens/shared/domain/access";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuditRecord } from "../../audit";
import { wasAccountCommandReplayed } from "../commands";
import type { AccountRouteDependencies } from "./accountRouteDependencies";

export function replyHelpers(dependencies: AccountRouteDependencies) {
  const { authMode, administration: accountAdminPort, authorize, audit, fail: accountFail } = dependencies;

  const isKnownRole = isAccountRole;

  const validationFailed = (message: string) =>
    new AccountContractError({ code: "VALIDATION_FAILED", message, retryable: false });

  const memberNotFound = (command: CommandIdentity) =>
    new AccountContractError({
      code: "NOT_FOUND",
      message: "Not a member of this account.",
      retryable: false,
      commandId: command.commandId,
    });

  // Every mutation route audits its own record UNLESS the command was a replay (audit already
  // happened on first execution) — `extra` lets a route fold in one more precondition (e.g.
  // "only if something actually changed") without re-deriving the replay check at each call site.
  const auditUnlessReplayed = (reply: FastifyReply, result: unknown, record: AuditRecord, extra = true): void => {
    if (extra && !wasAccountCommandReplayed(result)) audit(reply, record);
  };

  // ── Member management (P1.11) ────────────────────────────────────────────────────────────────
  // Owner/Admin list / change-role / revoke members of THEIR account, plus list / revoke outstanding
  // invites. Every route gates through the SAME authorize seam (cross-tenant → 403 automatically):
  // members under 'manageMembers', invites under 'manageInvites' (both admin-tier). The pure shared
  // guards (canManageMemberRole / canRemoveMember) keep Owner outside ordinary role and removal
  // operations for every actor. Owner changes are not ordinary member mutations: the single
  // Owner moves only through the transactional transfer endpoint, while a partial unique index and
  // boot assertion enforce exactly one Owner for every member-bearing company. OFF mode
  // (trusted-local) has no real member model, so the list routes return empty and mutation routes
  // explicitly report the unavailable capability instead of claiming an inert request committed.
  const rejectTrustedLocalMemberMutation = (reply: FastifyReply): unknown =>
    reply.code(400).send({
      error: "Member management is unavailable in trusted-local mode.",
    });

  // Gate shared by every member-mutation route below: admin-tier authorize() first (it sends its own
  // 403/404 on failure), then OFF mode's "no real member model" refusal. Same order/short-circuit as
  // each call site had inline.
  const authorizeMemberMutation = (
    req: FastifyRequest,
    reply: FastifyReply,
    accountId: string,
    action: Action,
  ): boolean => {
    if (!authorize(req, reply, accountId, action)) return false;
    if (authMode === "off") {
      rejectTrustedLocalMemberMutation(reply);
      return false;
    }
    return true;
  };

  // Shared by reset-password and revoke-sessions below: both need the target's membership row,
  // INCLUDING inactive ones, before doing security-sensitive work. includeInactive: an existence
  // probe, not an authorization one (that is the port's job just below). An admin disables a
  // compromised account first and rotates its password / kills its sessions second, so an
  // active-only probe here would 404 exactly the case these routes exist for.
  const requireMembership = async (
    reply: FastifyReply,
    accountId: string,
    userId: string,
    command: CommandIdentity,
  ) => {
    const membership = await accountAdminPort.getMembership({
      principalId: userId,
      workspaceId: accountId,
      includeInactive: true,
    });
    if (!membership) accountFail(reply, memberNotFound(command));
    return membership;
  };
  return {
    isKnownRole,
    validationFailed,
    memberNotFound,
    auditUnlessReplayed,
    rejectTrustedLocalMemberMutation,
    authorizeMemberMutation,
    requireMembership,
  };
}

export type AccountRouteContext = AccountRouteDependencies & ReturnType<typeof replyHelpers>;
