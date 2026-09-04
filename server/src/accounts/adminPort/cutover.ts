import { canAdministerAccount } from "@capacitylens/shared/account/policy";
import {
  assertControlTablesCurrent,
  assertSingleOwnerControlPlaneCurrent,
  getActiveMemberRole,
  listMembersForAccount,
  listMembershipsForUser,
  removeAllInvitesForAccount,
  removeAllMembersForAccount,
  upsertMember,
} from "../../controlTables";
import type { Db } from "../../db";
import { getRow } from "../../db";
import { assertAccountAuthority, assertAdministrativeAssurance, roleMap } from "./authority";
import type { AdminPortContext } from "./contracts";
import type { SsoCutoverAccountAdminPort, SsoCutoverWorkspaceFact } from "./contracts";
import { failure } from "./failures";
import { membership } from "./mappers";

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
export function createCutover(
  context: Pick<AdminPortContext, "db" | "trustedLocal" | "requireMfa">,
): Pick<
  SsoCutoverAccountAdminPort,
  | "inspectSsoCutoverWorkspaces"
  | "repairOwnerlessWorkspaceInTx"
  | "roleForPrincipalInWorkspace"
  | "workspacePrincipalIds"
  | "evaluateWorkspaceProvisioningAuthorityInTx"
  | "provisionOwnerMembershipInTx"
  | "assertWorkspaceErasureAuthorityInTx"
  | "eraseWorkspaceAdministrationInTx"
> {
  const { db, trustedLocal, requireMfa } = context;

  return {
    inspectSsoCutoverWorkspaces(): readonly SsoCutoverWorkspaceFact[] {
      return (
        db.prepare(`SELECT id, name FROM accounts ORDER BY name, id`).all() as Array<{ id: string; name: string }>
      ).map((workspace) => ({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        members: listMembersForAccount(db, workspace.id)
          .filter((member) => member.status === "active")
          .map((member) => ({ principalId: member.userId, role: member.role, status: "active" as const })),
      }));
    },
    repairOwnerlessWorkspaceInTx(workspaceId, principalId) {
      const members = listMembersForAccount(db, workspaceId).filter((member) => member.status === "active");
      const target = members.find((member) => member.userId === principalId);
      if (!target || members.some((member) => member.role === "owner")) return false;
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
    evaluateWorkspaceProvisioningAuthorityInTx({
      actor,
      multiWorkspace,
      bootstrapAuthorized,
      projectedWorkspaceCount,
    }) {
      const count = Number(
        (db.prepare(`SELECT COUNT(*) AS count FROM accounts`).get() as { count?: number | bigint } | undefined)
          ?.count ?? 0,
      );
      const effectiveCount = projectedWorkspaceCount ?? count + 1;
      if (effectiveCount > 1 && !multiWorkspace) {
        return { allowed: false, reason: "single-workspace-cap" };
      }
      if (count === 0 || trustedLocal || bootstrapAuthorized) return { allowed: true };
      const allowed = [...roleMap(db, actor.principalId).values()].some((role) =>
        canAdministerAccount(role, "manage-members"),
      );
      if (!allowed) return { allowed: false, reason: "insufficient-authority" };
      // This arm converts existing account administration into a new Owner grant. Apply the same
      // step-up boundary as membership and invitation administration after proving the role, so a
      // lower-privilege caller still receives the ordinary authority refusal.
      assertAdministrativeAssurance(actor, requireMfa, trustedLocal);
      return { allowed: true };
    },
    provisionOwnerMembershipInTx({ workspaceId, principalId, joinedAt }) {
      upsertMember(db, {
        accountId: workspaceId,
        userId: principalId,
        role: "owner",
        status: "active",
        createdAt: joinedAt,
      });
      const row = listMembershipsForUser(db, principalId).find((candidate) => candidate.accountId === workspaceId);
      if (!row) throw new Error("Workspace provisioning did not create its Owner membership.");
      return membership(db, row);
    },
    assertWorkspaceErasureAuthorityInTx(actor, workspaceId): void {
      assertAdministrativeAssurance(actor, requireMfa, trustedLocal);
      const role = assertAccountAuthority(db, actor, workspaceId, "erase-workspace", trustedLocal);
      if (role !== "owner") throw failure("FORBIDDEN", "Only the workspace owner may erase it.");
    },
    eraseWorkspaceAdministrationInTx(workspaceId) {
      const principalIds = [...new Set(listMembersForAccount(db, workspaceId).map((row) => row.userId))];
      removeAllMembersForAccount(db, workspaceId);
      removeAllInvitesForAccount(db, workspaceId);
      return principalIds.filter(
        (principalId) =>
          !listMembershipsForUser(db, principalId).some((row) => getRow(db, "accounts", row.accountId) !== undefined),
      );
    },
  };
}
