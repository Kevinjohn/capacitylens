import { canChangeMemberStatus, canManageMemberRole, canRemoveMember } from "@capacitylens/shared/account/policy";
import type { OwnershipTransfer } from "@capacitylens/shared/account/types";
import {
  getActiveMemberRole,
  getMembershipRow,
  listMembersForAccount,
  listMembershipsForUser,
  removeMember as removeMemberRow,
  setMemberStatus,
  upsertMember,
} from "../../controlTables";
import { getRow } from "../../db";
import { receipt } from "../accountFlowRuntime";
import { getSecurityRevision } from "../state";
import { assertAccountAuthority, assertAdministrativeAssurance } from "./authority";
import type { AdminPortContext } from "./contracts";
import { ACCOUNT_POLICY_VERSION, SsoCutoverAccountAdminPort } from "./contracts";
import { assertInvitationRole, failure } from "./failures";
import { membership, securityRevisionsByPrincipal } from "./mappers";

export function createMembership(
  context: Pick<AdminPortContext, "db" | "trustedLocal" | "requireMfa" | "runMutation">,
): Pick<
  SsoCutoverAccountAdminPort,
  | "listWorkspacesForPrincipal"
  | "getMembership"
  | "listMemberships"
  | "changeMemberRole"
  | "changeMemberStatus"
  | "removeMember"
  | "transferOwnership"
> {
  const { db, trustedLocal, requireMfa, runMutation } = context;

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
                  membershipRevision: String(getSecurityRevision(db, principalId)),
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
      return row ? membership(db, row) : null;
    },
    async listMemberships({ actor, workspaceId, includeInactive = false }) {
      assertAdministrativeAssurance(actor, requireMfa, trustedLocal);
      assertAccountAuthority(db, actor, workspaceId, "list-members", trustedLocal);
      // Default active-only. `includeInactive` is a LISTING widening for the administrative
      // directory, never an authorization one — this read is already gated on 'list-members', and
      // the returned rows carry their real status so a caller cannot mistake a disabled membership
      // for an active one.
      const rows = listMembersForAccount(db, workspaceId).filter((row) => includeInactive || row.status === "active");
      // N+1 fix: one bulk revision query (chunked) instead of one `getSecurityRevision` per member.
      // The output shape/coercion must match `membership()` exactly, so this builds the same object
      // by hand rather than introduce a second membership-mapping function.
      const revisions = securityRevisionsByPrincipal(db, [...new Set(rows.map((row) => row.userId))]);
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
          assertAdministrativeAssurance(actor, requireMfa, trustedLocal, command.commandId);
          const acting = assertAccountAuthority(db, actor, workspaceId, "manage-members", trustedLocal);
          const target = getActiveMemberRole(db, workspaceId, targetPrincipalId);
          if (!target) throw failure("NOT_FOUND", "Not a member of this workspace.", command.commandId);
          if (!canManageMemberRole(acting, target, nextRole))
            throw failure("FORBIDDEN", "Forbidden.", command.commandId);
          upsertMember(db, {
            accountId: workspaceId,
            userId: targetPrincipalId,
            role: nextRole,
            status: "active",
            createdAt: new Date().toISOString(),
          });
          const row = listMembershipsForUser(db, targetPrincipalId).find(
            (candidate) => candidate.accountId === workspaceId,
          )!;
          return membership(db, row);
        },
      });
    },
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
          assertAdministrativeAssurance(actor, requireMfa, trustedLocal, command.commandId);
          const acting = assertAccountAuthority(db, actor, workspaceId, "manage-members", trustedLocal);
          // Status-AGNOSTIC lookup, unlike changeMemberRole's getActiveMemberRole: restoring a
          // disabled or archived membership is the whole point, and an active-only read would make
          // every such target look like a non-member.
          const target = getMembershipRow(db, workspaceId, targetPrincipalId);
          if (!target) throw failure("NOT_FOUND", "Not a member of this workspace.", command.commandId);
          if (!canChangeMemberStatus(acting, target.role, targetPrincipalId === actor.principalId))
            throw failure("FORBIDDEN", "Forbidden.", command.commandId);
          // "unchanged" is success, not a fault: the membership already holds the requested status,
          // so the caller's intent is satisfied and no reset link should have been burned for it.
          if (setMemberStatus(db, workspaceId, targetPrincipalId, nextStatus) === "missing")
            throw failure("NOT_FOUND", "Not a member of this workspace.", command.commandId);
          // The post-write row is the pre-write row with the new status — the write above changed
          // nothing else. Re-reading it would only re-derive what we already hold.
          return membership(db, { ...target, status: nextStatus });
        },
      });
    },
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
          assertAdministrativeAssurance(actor, requireMfa, trustedLocal, command.commandId);
          const acting = assertAccountAuthority(db, actor, workspaceId, "manage-members", trustedLocal);
          // Status-AGNOSTIC, like changeMemberStatus and for the same reason: the members table
          // lists non-active rows so an administrator can act on them. An active-only read made
          // Remove 404 on exactly those rows, leaving no way to delete a disabled membership
          // except to restore the member's access first — the opposite of the intent.
          const target = getMembershipRow(db, workspaceId, targetPrincipalId);
          if (!target) throw failure("NOT_FOUND", "Not a member of this workspace.", command.commandId);
          if (!canRemoveMember(acting, target.role)) throw failure("FORBIDDEN", "Forbidden.", command.commandId);
          removeMemberRow(db, workspaceId, targetPrincipalId);
          return receipt(command.commandId);
        },
      });
    },
    async transferOwnership({ actor, workspaceId, targetPrincipalId, command }): Promise<OwnershipTransfer> {
      return runMutation({
        operation: "transfer-ownership",
        actorPrincipalId: actor.principalId,
        targetPrincipalId,
        workspaceId,
        command,
        payload: { workspaceId, targetPrincipalId },
        lockKeys: [actor.principalId, targetPrincipalId, `workspace:${workspaceId}`],
        audit: {
          action: "ownership.transferred",
          changedFields: ["role", "owner"],
        },
        execute: () => {
          assertAdministrativeAssurance(actor, requireMfa, trustedLocal, command.commandId);
          assertAccountAuthority(db, actor, workspaceId, "transfer-ownership", trustedLocal);
          if (actor.principalId === targetPrincipalId) {
            throw failure("VALIDATION_FAILED", "The actor already owns this workspace.", command.commandId);
          }
          if (!getActiveMemberRole(db, workspaceId, targetPrincipalId)) {
            throw failure("NOT_FOUND", "The next owner must already be a member.", command.commandId);
          }
          const now = new Date().toISOString();
          upsertMember(db, {
            accountId: workspaceId,
            userId: actor.principalId,
            role: "admin",
            status: "active",
            createdAt: now,
          });
          upsertMember(db, {
            accountId: workspaceId,
            userId: targetPrincipalId,
            role: "owner",
            status: "active",
            createdAt: now,
          });
          const prior = listMembershipsForUser(db, actor.principalId).find((row) => row.accountId === workspaceId)!;
          const next = listMembershipsForUser(db, targetPrincipalId).find((row) => row.accountId === workspaceId)!;
          return {
            previousOwner: membership(db, prior),
            nextOwner: membership(db, next),
          };
        },
      });
    },
  };
}
