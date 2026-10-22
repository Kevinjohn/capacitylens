import {
  assertControlTablesCurrent,
  assertSingleOwnerControlPlaneCurrent,
  getActiveMemberRole,
  listMembersForAccount,
  listMembershipsForUser,
  terminaliseLiveRequestsForAccount,
  upsertMember,
} from "../../controlTables";
import type { Db } from "../../db";
import { getRow } from "../../db";
import type { SsoCutoverAccountAdminPort, SsoCutoverWorkspaceFact } from "./contracts";

/** Account-adapter-owned facts for the sole-Owner recovery tool, so it needs no direct control
 * table access. The single-active-owner index makes "active Owner" identical to "sole active
 * Owner", which is precisely the authority condition the tool refuses without. */
export function listSoleOwnerAccountIds(db: Db, principalId: string): string[] {
  return listMembershipsForUser(db, principalId)
    .map((membership) => membership.accountId)
    .filter((accountId) => getActiveMemberRole(db, accountId, principalId) === "owner");
}

/** Control-plane currency for offline tools: both the column contract and the exactly-one-Owner
 * physical invariant, asserted before any recovery reasoning happens over their rows. */
export function assertAccountControlPlaneCurrent(db: Db): void {
  assertAccountControlPlaneSchemaCurrent(db);
  assertSingleOwnerControlPlaneCurrent(db);
}

/** Schema-only half of the control-plane assertion for the narrowly scoped tools whose purpose is
 * to repair ownerless/memberless data that the full invariant must reject. */
export function assertAccountControlPlaneSchemaCurrent(db: Db): void {
  assertControlTablesCurrent(db);
}

/** Builds the SQLite-backed cutover inspection and ownerless-workspace repair capabilities. */
export function createCutoverInspection(
  db: Db,
): Pick<
  SsoCutoverAccountAdminPort,
  | "inspectSsoCutoverWorkspaces"
  | "repairOwnerlessWorkspaceInTx"
  | "roleForPrincipalInWorkspace"
  | "workspacePrincipalIds"
> {
  return {
    inspectSsoCutoverWorkspaces(): readonly SsoCutoverWorkspaceFact[] {
      return (
        db.prepare(`SELECT id, name FROM accounts ORDER BY name, id`).all() as Array<{ id: string; name: string }>
      ).map((workspace) => ({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        members: listMembersForAccount(db, workspace.id)
          .filter((member) => getActiveMemberRole(db, workspace.id, member.userId) !== null)
          .map((member) => ({ principalId: member.userId, role: member.role, status: "active" as const })),
      }));
    },
    repairOwnerlessWorkspaceInTx(workspaceId, principalId) {
      const members = listMembersForAccount(db, workspaceId).filter(
        (member) => getActiveMemberRole(db, workspaceId, member.userId) !== null,
      );
      const target = members.find((member) => member.userId === principalId);
      if (!target || members.some((member) => member.role === "owner")) return false;
      // Why: stopped-server repair has no request audit port. The retained terminal row is
      // durable evidence that the nomination ended because the workspace Owner was repaired.
      terminaliseLiveRequestsForAccount({
        db,
        accountId: workspaceId,
        reason: "owner_repaired",
        now: new Date().toISOString(),
      });
      upsertMember(db, { ...target, role: "owner" });
      return true;
    },
    roleForPrincipalInWorkspace(principalId, workspaceId) {
      if (!getRow(db, "accounts", workspaceId)) return null;
      return getActiveMemberRole(db, workspaceId, principalId);
    },
    workspacePrincipalIds(workspaceId) {
      return listMembersForAccount(db, workspaceId).map((row) => row.userId);
    },
  };
}
