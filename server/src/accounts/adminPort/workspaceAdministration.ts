import { canAdministerAccount } from "@capacitylens/shared/account/policy";
import {
  listMembersForAccount,
  listMembershipsForUser,
  removeAllInvitesForAccount,
  removeAllMembersForAccount,
  deleteRequestsForAccount,
  upsertMember,
} from "../../controlTables";
import { getRow } from "../../db";
import { assertAccountAuthority, assertAdministrativeAssurance } from "./accountAuthority";
import { readActorRolesByWorkspaceId } from "./identityAdminAuthority";
import type { AdminPortContext, SsoCutoverAccountAdminPort } from "./contracts";
import { createAccountFailure } from "./failures";
import { readMembership } from "./mappers";

function createWorkspaceLifecycle(
  context: Pick<AdminPortContext, "db" | "trustedLocal">,
): Pick<
  SsoCutoverAccountAdminPort,
  "provisionOwnerMembershipInTx" | "assertWorkspaceErasureAuthorityInTx" | "eraseWorkspaceAdministrationInTx"
> {
  const { db, trustedLocal } = context;
  return {
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
      return readMembership(db, row);
    },
    assertWorkspaceErasureAuthorityInTx(actor, workspaceId): void {
      assertAdministrativeAssurance({ actor, trustedLocal });
      const role = assertAccountAuthority({ db, actor, workspaceId, action: "erase-workspace", trustedLocal });
      if (role !== "owner") throw createAccountFailure("FORBIDDEN", "Only the workspace owner may erase it.");
    },
    eraseWorkspaceAdministrationInTx(workspaceId) {
      // Why: the existing workspace-erasure audit event records that the company, and every
      // ceremony in it, ended. The rows themselves go, rather than being terminalised first: this
      // deletes in the same transaction, so an invalidation written here would never be visible to
      // anyone, and the audit trail of why the ceremony ended outlives the rows anyway.
      deleteRequestsForAccount(db, workspaceId);
      const principalIds = [...new Set(listMembersForAccount(db, workspaceId).map((row) => row.userId))];
      removeAllMembersForAccount(db, workspaceId);
      const accessRestrictionTableExists = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'account_access_restrictions'`)
        .get();
      const schemaVersion = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      if (accessRestrictionTableExists || schemaVersion >= 47) {
        db.prepare(`DELETE FROM account_access_restrictions WHERE accountId = ?`).run(workspaceId);
      }
      const joiningPolicyTableExists = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'account_joining_policies'`)
        .get();
      if (joiningPolicyTableExists || schemaVersion >= 49) {
        db.prepare(`DELETE FROM account_joining_policies WHERE accountId = ?`).run(workspaceId);
        db.prepare(`DELETE FROM company_join_intents WHERE accountId = ?`).run(workspaceId);
      }
      removeAllInvitesForAccount(db, workspaceId);
      return principalIds.filter(
        (principalId) =>
          !listMembershipsForUser(db, principalId).some((row) => getRow(db, "accounts", row.accountId) !== null),
      );
    },
  };
}

function createProvisioningAuthority(
  context: Pick<AdminPortContext, "db" | "trustedLocal">,
): Pick<SsoCutoverAccountAdminPort, "evaluateWorkspaceProvisioningAuthorityInTx"> {
  const { db, trustedLocal } = context;
  return {
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
      const allowed = [...readActorRolesByWorkspaceId(db, actor.principalId).values()].some((role) =>
        canAdministerAccount(role, "manage-members"),
      );
      if (!allowed) return { allowed: false, reason: "insufficient-authority" };
      // Provisioning a new Owner requires fresh assurance after role authorization succeeds.
      assertAdministrativeAssurance({ actor, trustedLocal });
      return { allowed: true };
    },
  };
}

/** Composes workspace membership and provisioning authority operations. */
export function createWorkspaceAdministration(
  context: Pick<AdminPortContext, "db" | "trustedLocal">,
): Pick<
  SsoCutoverAccountAdminPort,
  | "evaluateWorkspaceProvisioningAuthorityInTx"
  | "provisionOwnerMembershipInTx"
  | "assertWorkspaceErasureAuthorityInTx"
  | "eraseWorkspaceAdministrationInTx"
> {
  return { ...createWorkspaceLifecycle(context), ...createProvisioningAuthority(context) };
}
