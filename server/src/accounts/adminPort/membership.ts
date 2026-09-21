import { canChangeMemberStatus, canManageMemberRole, canRemoveMember } from "@capacitylens/shared/account/policy";
import {
  getActiveMemberRole,
  getMembershipRow,
  listMembersForAccount,
  listMembershipsForUser,
  removeMember as removeMemberRow,
  setMemberStatus,
  upsertMember,
  type AccountMember,
} from "../../controlTables";
import { getRow, type Db } from "../../db";
import type { AccountAuditInput } from "../accountFlowRuntime";
import { createOperationReceipt } from "../accountFlowRuntime";
import { readSecurityRevision } from "../state";
import { assertAccountAuthority, assertAdministrativeAssurance } from "./authority";
import type { AdminPortContext } from "./contracts";
import { ACCOUNT_POLICY_VERSION, SsoCutoverAccountAdminPort } from "./contracts";
import { assertInvitationRole, createAccountFailure } from "./failures";
import { readMembership, readSecurityRevisionsByPrincipalId } from "./mappers";

type MembershipContext = Pick<AdminPortContext, "db" | "trustedLocal" | "requireMfa" | "runMutation" | "audit">;
type MembershipPort = Pick<
  SsoCutoverAccountAdminPort,
  | "listWorkspacesForPrincipal"
  | "getMembership"
  | "listMemberships"
  | "changeMemberRole"
  | "changeMemberStatus"
  | "removeMember"
>;

function readRequiredMembership(db: Db, principalId: string, workspaceId: string): AccountMember {
  const row = listMembershipsForUser(db, principalId).find((candidate) => candidate.accountId === workspaceId);
  if (!row) {
    throw new Error(`Membership write did not produce ${workspaceId}/${principalId}.`);
  }
  return row;
}

function createMembershipReads({
  db,
  trustedLocal,
  requireMfa,
}: MembershipContext): Pick<MembershipPort, "listWorkspacesForPrincipal" | "getMembership" | "listMemberships"> {
  return {
    async listWorkspacesForPrincipal({ principalId }) {
      return listMembershipsForUser(db, principalId)
        .filter((row) => row.status === "active")
        .flatMap((row) => {
          const workspace = getRow(db, "accounts", row.accountId);
          return workspace
            ? [
                {
                  workspaceId: row.accountId,
                  workspaceName: String(workspace.name),
                  role: row.role,
                  membershipRevision: String(readSecurityRevision(db, principalId)),
                  policyVersion: ACCOUNT_POLICY_VERSION,
                },
              ]
            : [];
        })
        .sort(
          (left, right) =>
            left.workspaceName.localeCompare(right.workspaceName) || left.workspaceId.localeCompare(right.workspaceId),
        );
    },
    async getMembership({ principalId, workspaceId, includeInactive = false }) {
      if (!getRow(db, "accounts", workspaceId)) return null;
      const row = listMembershipsForUser(db, principalId).find(
        (candidate) => candidate.accountId === workspaceId && (includeInactive || candidate.status === "active"),
      );
      return row ? readMembership(db, row) : null;
    },
    async listMemberships({ actor, workspaceId, includeInactive = false, requireFresh = true }) {
      assertAdministrativeAssurance({ actor, requireMfa, trustedLocal, requireFresh });
      assertAccountAuthority({ db, actor, workspaceId, action: "list-members", trustedLocal });
      // `includeInactive` widens the administrative listing, never authorization: the read is
      // already gated above and every returned row retains its real status.
      const rows = listMembersForAccount(db, workspaceId).filter((row) => includeInactive || row.status === "active");
      // One chunked bulk revision query avoids an N+1 read while preserving readMembership's shape.
      const revisions = readSecurityRevisionsByPrincipalId(db, [...new Set(rows.map((row) => row.userId))]);
      return rows.map((row) => ({
        workspaceId: row.accountId,
        principalId: row.userId,
        role: row.role,
        status: row.status,
        joinedAt: row.createdAt,
        membershipRevision: String(revisions.get(row.userId) ?? 0),
        policyVersion: ACCOUNT_POLICY_VERSION,
      }));
    },
  };
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

function createStatusChange({
  db,
  trustedLocal,
  requireMfa,
  runMutation,
  audit,
}: MembershipContext): Pick<MembershipPort, "changeMemberStatus"> {
  return {
    async changeMemberStatus({ actor, workspaceId, targetPrincipalId, nextStatus, command }) {
      return runMutation({
        operation: "change-member-status",
        actorPrincipalId: actor.principalId,
        targetPrincipalId,
        workspaceId,
        command,
        payload: { workspaceId, targetPrincipalId, nextStatus },
        lockKeys: [actor.principalId, targetPrincipalId, `workspace:${workspaceId}`],
        audit: { action: "member.status_changed", changedFields: ["status"] },
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
          // "unchanged" is success: the requested state already holds and no reset link is burned.
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
          return readMembership(db, { ...target, status: nextStatus });
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
