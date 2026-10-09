import type { SsoCutoverAccountAdminPort } from "./contracts";
import type { AdminPortContext } from "./contracts";
import { ACCOUNT_POLICY_VERSION } from "./contracts";
import { assertAccountAuthority, assertAdministrativeAssurance } from "./authority";
import { readMembership, readSecurityRevisionsByPrincipalId } from "./mappers";
import { readSecurityRevision } from "../state";
import { getRow } from "../../db";
import {
  isAccessRestricted,
  listAccessRestrictions,
  listMembersForAccount,
  listMembershipsForUser,
} from "../../controlTables";

// The three administrative reads share one authorization and projection boundary.
// eslint-disable-next-line max-lines-per-function
export function createMembershipReads({
  db,
  trustedLocal,
}: Pick<AdminPortContext, "db" | "trustedLocal">): Pick<
  SsoCutoverAccountAdminPort,
  "listWorkspacesForPrincipal" | "getMembership" | "listMemberships"
> {
  return {
    async listWorkspacesForPrincipal({ principalId }) {
      return listMembershipsForUser(db, principalId)
        .filter((row) => row.status === "active" && !isAccessRestricted(db, row.accountId, principalId))
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
        (candidate) =>
          candidate.accountId === workspaceId &&
          (includeInactive || (candidate.status === "active" && !isAccessRestricted(db, workspaceId, principalId))),
      );
      return row
        ? { ...readMembership(db, row), accessDisabled: isAccessRestricted(db, workspaceId, principalId) }
        : null;
    },
    async listMemberships({ actor, workspaceId, includeInactive = false, requireFresh = true }) {
      assertAdministrativeAssurance({ actor, trustedLocal, requireFresh });
      assertAccountAuthority({ db, actor, workspaceId, action: "list-members", trustedLocal });
      // `includeInactive` widens the administrative listing, never authorization: the read is
      // already gated above and every returned row retains its real status.
      const rows = listMembersForAccount(db, workspaceId).filter((row) => includeInactive || row.status === "active");
      // One chunked bulk revision query avoids an N+1 read while preserving readMembership's shape.
      const revisions = readSecurityRevisionsByPrincipalId(db, [...new Set(rows.map((row) => row.userId))]);
      const members = rows.map((row) => ({
        workspaceId: row.accountId,
        principalId: row.userId,
        role: row.role,
        status: row.status,
        accessDisabled: isAccessRestricted(db, workspaceId, row.userId),
        membershipPresent: true,
        joinedAt: row.createdAt,
        membershipRevision: String(revisions.get(row.userId) ?? 0),
        policyVersion: ACCOUNT_POLICY_VERSION,
      }));
      const memberIds = new Set(rows.map((row) => row.userId));
      const removed = includeInactive
        ? listAccessRestrictions(db, workspaceId)
            .filter((restriction) => !memberIds.has(restriction.principalId))
            .map((restriction) => ({
              workspaceId,
              principalId: restriction.principalId,
              role: restriction.role,
              status: "disabled" as const,
              accessDisabled: true,
              membershipPresent: false,
              restrictionEmail: restriction.verifiedEmail,
              joinedAt: restriction.createdAt,
              membershipRevision: String(revisions.get(restriction.principalId) ?? 0),
              policyVersion: ACCOUNT_POLICY_VERSION,
            }))
        : [];
      return [...members, ...removed];
    },
  };
}
