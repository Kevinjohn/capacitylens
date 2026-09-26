import { canChangeMemberStatus, canManageMemberRole, canRemoveMember } from "@capacitylens/shared/account/policy";
import {
  disableAccess,
  captureRestrictionEmail,
  enableAccess,
  getAccessRestriction,
  getActiveMemberRole,
  getMembershipRow,
  isAccessRestricted,
  invalidateRestrictedPrincipal,
  listMembersForAccount,
  listMembershipsForUser,
  provenEmail,
  removeMember as removeMemberRow,
  setMemberStatus,
  upsertMember,
  type AccountMember,
} from "../../controlTables";
import type { Db } from "../../db";
import type { AccountAuditInput } from "../accountFlowRuntime";
import { createOperationReceipt } from "../accountFlowRuntime";
import { assertAccountAuthority, assertAdministrativeAssurance } from "./authority";
import type { AdminPortContext } from "./contracts";
import { ACCOUNT_POLICY_VERSION, SsoCutoverAccountAdminPort } from "./contracts";
import { assertInvitationRole, createAccountFailure } from "./failures";
import { readMembership } from "./mappers";
import { createMembershipReads } from "./memberReads";

type MembershipContext = Pick<AdminPortContext, "db" | "trustedLocal" | "requireMfa" | "runMutation" | "audit">;
type MembershipPort = Pick<
  SsoCutoverAccountAdminPort,
  | "listWorkspacesForPrincipal"
  | "getMembership"
  | "listMemberships"
  | "changeMemberRole"
  | "changeMemberStatus"
  | "enableMemberAccess"
  | "removeMember"
>;

function readRequiredMembership(db: Db, principalId: string, workspaceId: string): AccountMember {
  const row = listMembershipsForUser(db, principalId).find((candidate) => candidate.accountId === workspaceId);
  if (!row) {
    throw new Error(`Membership write did not produce ${workspaceId}/${principalId}.`);
  }
  return row;
}

function createRoleChange({
  db,
  trustedLocal,
  requireMfa,
  runMutation,
  audit,
}: MembershipContext): Pick<MembershipPort, "changeMemberRole"> {
  return {
    async changeMemberRole({ actor, workspaceId, targetPrincipalId, nextRole, command }) {
      assertInvitationRole(nextRole, command.commandId);
      return runMutation({
        operation: "change-member-role",
        actorPrincipalId: actor.principalId,
        targetPrincipalId,
        workspaceId,
        command,
        payload: { workspaceId, targetPrincipalId, nextRole },
        lockKeys: [actor.principalId, targetPrincipalId, `workspace:${workspaceId}`],
        audit: { action: "member.role_changed", changedFields: ["role"] },
        execute: () => {
          assertAdministrativeAssurance({
            actor,
            requireMfa,
            trustedLocal,
            commandId: command.commandId,
            requireFresh: false,
          });
          const acting = assertAccountAuthority({ db, actor, workspaceId, action: "manage-members", trustedLocal });
          const target = getActiveMemberRole(db, workspaceId, targetPrincipalId);
          if (!target) throw createAccountFailure("NOT_FOUND", "Not a member of this workspace.", command.commandId);
          if (!canManageMemberRole(acting, target, nextRole))
            throw createAccountFailure("FORBIDDEN", "Forbidden.", command.commandId);
          const invalidatedTransferIds = upsertMember(db, {
            accountId: workspaceId,
            userId: targetPrincipalId,
            role: nextRole,
            status: "active",
            createdAt: new Date().toISOString(),
          });
          writeInvalidatedTransferAudits(audit, invalidatedTransferIds, {
            actorPrincipalId: actor.principalId,
            targetPrincipalId,
            workspaceId,
            command,
          });
          return readMembership(db, readRequiredMembership(db, targetPrincipalId, workspaceId));
        },
      });
    },
  };
}

// Both commands share the same administrative mutation and audit boundary.
// eslint-disable-next-line max-lines-per-function
function createStatusChange({
  db,
  trustedLocal,
  requireMfa,
  runMutation,
  audit,
}: MembershipContext): Pick<MembershipPort, "changeMemberStatus" | "enableMemberAccess"> {
  return {
    // The transaction keeps authority, alias checks, restriction, and audit writes together.
    // eslint-disable-next-line max-lines-per-function
    async changeMemberStatus({ actor, workspaceId, targetPrincipalId, nextStatus, command }) {
      return runMutation({
        operation: "change-member-status",
        actorPrincipalId: actor.principalId,
        targetPrincipalId,
        workspaceId,
        command,
        payload: { workspaceId, targetPrincipalId, nextStatus },
        lockKeys: [actor.principalId, targetPrincipalId, `workspace:${workspaceId}`],
        audit: {
          action: nextStatus === "disabled" ? "member.access_disabled" : "member.status_changed",
          changedFields: [nextStatus === "disabled" ? "accessRestriction" : "status"],
        },
        // The write and all newly restricted aliases share one transaction and audit boundary.
        // eslint-disable-next-line max-lines-per-function
        execute: () => {
          assertAdministrativeAssurance({
            actor,
            requireMfa,
            trustedLocal,
            commandId: command.commandId,
            requireFresh: false,
          });
          const acting = assertAccountAuthority({ db, actor, workspaceId, action: "manage-members", trustedLocal });
          // Status-agnostic: restoring a disabled or archived membership is the operation's purpose.
          const target = getMembershipRow(db, workspaceId, targetPrincipalId);
          if (!target) throw createAccountFailure("NOT_FOUND", "Not a member of this workspace.", command.commandId);
          if (!canChangeMemberStatus(acting, target.role, targetPrincipalId === actor.principalId))
            throw createAccountFailure("FORBIDDEN", "Forbidden.", command.commandId);
          // Repeat Disable can widen a principal-only restriction after fresh mailbox proof.
          if (nextStatus === "disabled") {
            const targetEmail = provenEmail(db, targetPrincipalId);
            const matched =
              targetEmail === null
                ? []
                : listMembersForAccount(db, workspaceId).filter(
                    (member) => provenEmail(db, member.userId) === targetEmail,
                  );
            if (matched.some((member) => member.userId === actor.principalId || member.role === "owner"))
              throw createAccountFailure("FORBIDDEN", "Forbidden.", command.commandId);
            const newlyAffected = [...new Set([targetPrincipalId, ...matched.map((member) => member.userId)])].filter(
              (principalId) => !isAccessRestricted(db, workspaceId, principalId),
            );
            if (!getAccessRestriction(db, workspaceId, targetPrincipalId)) {
              disableAccess(db, {
                accountId: workspaceId,
                principalId: targetPrincipalId,
                role: target.role,
              });
            } else {
              captureRestrictionEmail(db, workspaceId, targetPrincipalId);
            }
            for (const principalId of newlyAffected) {
              if (!isAccessRestricted(db, workspaceId, principalId)) continue;
              const invalidatedTransferIds = invalidateRestrictedPrincipal(db, workspaceId, principalId);
              writeInvalidatedTransferAudits(audit, invalidatedTransferIds, {
                actorPrincipalId: actor.principalId,
                targetPrincipalId: principalId,
                workspaceId,
                command,
              });
            }
            return { ...readMembership(db, target), accessDisabled: true };
          }
          const result = setMemberStatus({ db, accountId: workspaceId, userId: targetPrincipalId, status: nextStatus });
          if (result.outcome === "missing")
            throw createAccountFailure("NOT_FOUND", "Not a member of this workspace.", command.commandId);
          writeInvalidatedTransferAudits(audit, result.invalidatedTransferIds, {
            actorPrincipalId: actor.principalId,
            targetPrincipalId,
            workspaceId,
            command,
          });
          // The write changes only status; re-reading would re-derive the row already held here.
          return {
            ...readMembership(db, { ...target, status: nextStatus }),
            accessDisabled: isAccessRestricted(db, workspaceId, targetPrincipalId),
          };
        },
      });
    },
    async enableMemberAccess({ actor, workspaceId, targetPrincipalId, command }) {
      return runMutation({
        operation: "enable-member-access",
        actorPrincipalId: actor.principalId,
        targetPrincipalId,
        workspaceId,
        command,
        payload: { workspaceId, targetPrincipalId },
        lockKeys: [actor.principalId, targetPrincipalId, `workspace:${workspaceId}`],
        audit: { action: "member.access_enabled", changedFields: ["accessRestriction"] },
        execute: () => {
          assertAdministrativeAssurance({
            actor,
            requireMfa,
            trustedLocal,
            commandId: command.commandId,
            requireFresh: false,
          });
          const acting = assertAccountAuthority({ db, actor, workspaceId, action: "manage-members", trustedLocal });
          const restriction = getAccessRestriction(db, workspaceId, targetPrincipalId);
          if (!restriction) throw createAccountFailure("NOT_FOUND", "Access restriction not found.", command.commandId);
          const target = getMembershipRow(db, workspaceId, targetPrincipalId);
          const targetRole = target?.role ?? restriction.role;
          if (!canChangeMemberStatus(acting, targetRole, targetPrincipalId === actor.principalId))
            throw createAccountFailure("FORBIDDEN", "Forbidden.", command.commandId);
          const matchingMembers = listMembersForAccount(db, workspaceId).filter((member) => {
            if (member.userId === targetPrincipalId) return true;
            if (restriction.verifiedEmail === null) return false;
            return provenEmail(db, member.userId) === restriction.verifiedEmail;
          });
          if (
            matchingMembers.some(
              (member) => !canChangeMemberStatus(acting, member.role, member.userId === actor.principalId),
            )
          )
            throw createAccountFailure("FORBIDDEN", "Forbidden.", command.commandId);
          enableAccess(db, workspaceId, targetPrincipalId);
          const accessDisabled = isAccessRestricted(db, workspaceId, targetPrincipalId);
          return target
            ? { ...readMembership(db, target), accessDisabled }
            : {
                workspaceId,
                principalId: targetPrincipalId,
                role: targetRole,
                status: "disabled" as const,
                accessDisabled,
                membershipPresent: false,
                joinedAt: restriction.createdAt,
                membershipRevision: "0",
                policyVersion: ACCOUNT_POLICY_VERSION,
              };
        },
      });
    },
  };
}

function createRemoval({
  db,
  trustedLocal,
  requireMfa,
  runMutation,
  audit,
}: MembershipContext): Pick<MembershipPort, "removeMember"> {
  return {
    async removeMember({ actor, workspaceId, targetPrincipalId, command }) {
      return runMutation({
        operation: "remove-member",
        actorPrincipalId: actor.principalId,
        targetPrincipalId,
        workspaceId,
        command,
        payload: { workspaceId, targetPrincipalId },
        lockKeys: [actor.principalId, targetPrincipalId, `workspace:${workspaceId}`],
        audit: { action: "member.removed", changedFields: ["membership"] },
        execute: () => {
          assertAdministrativeAssurance({
            actor,
            requireMfa,
            trustedLocal,
            commandId: command.commandId,
            requireFresh: false,
          });
          const acting = assertAccountAuthority({ db, actor, workspaceId, action: "manage-members", trustedLocal });
          // Status-agnostic so an administrator can remove non-active members without restoring access.
          const target = getMembershipRow(db, workspaceId, targetPrincipalId);
          if (!target) throw createAccountFailure("NOT_FOUND", "Not a member of this workspace.", command.commandId);
          if (!canRemoveMember(acting, target.role))
            throw createAccountFailure("FORBIDDEN", "Forbidden.", command.commandId);
          const invalidatedTransferIds = removeMemberRow(db, workspaceId, targetPrincipalId);
          writeInvalidatedTransferAudits(audit, invalidatedTransferIds, {
            actorPrincipalId: actor.principalId,
            targetPrincipalId,
            workspaceId,
            command,
          });
          return createOperationReceipt({ commandId: command.commandId });
        },
      });
    },
  };
}

function writeInvalidatedTransferAudits(
  audit: MembershipContext["audit"],
  requestIds: readonly string[],
  input: Pick<AccountAuditInput, "actorPrincipalId" | "targetPrincipalId" | "workspaceId" | "command">,
): void {
  for (const eventKey of requestIds) {
    audit({
      ...input,
      eventKey,
      action: "ownership_transfer.invalidated",
      outcome: "success",
      changedFields: ["state", "terminalReason"],
    });
  }
}

interface ExchangeOwnershipInput {
  db: Db;
  workspaceId: string;
  previousOwnerId: string;
  nextOwnerId: string;
  now: string;
}

/** The caller owns the transaction. Demotion must precede promotion: SQLite checks its unique
 * active-Owner index after each statement, including inside a transaction. */
export function exchangeOwnershipInTx({
  db,
  workspaceId,
  previousOwnerId,
  nextOwnerId,
  now,
}: ExchangeOwnershipInput): void {
  // "keep": these two writes ARE the ceremony completing, so they must not invalidate the request
  // they are applying. Every other membership write ends a live nomination naming its principal.
  upsertMember(
    db,
    { accountId: workspaceId, userId: previousOwnerId, role: "admin", status: "active", createdAt: now },
    "keep",
  );
  upsertMember(
    db,
    { accountId: workspaceId, userId: nextOwnerId, role: "owner", status: "active", createdAt: now },
    "keep",
  );
}

export function createMembership(context: MembershipContext): MembershipPort {
  return {
    ...createMembershipReads(context),
    ...createRoleChange(context),
    ...createStatusChange(context),
    ...createRemoval(context),
  };
}
