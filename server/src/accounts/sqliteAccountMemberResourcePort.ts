import type { AccountMemberResourcePort } from "@capacitylens/shared/account/ports";
import type { Db } from "../db";
import {
  clearAccountMemberResourceLink,
  listAccountMemberResourceLinks,
  listResourceAvatarProjection,
  reconcileAccountMemberResources,
  removeAccountMemberResourceForResource,
  setAccountMemberResourceLink,
} from "../controlTables/accountMemberResources";

/** Own the SQLite representation behind the shared account member/resource contract. */
export function createSqliteAccountMemberResourcePort(db: Db): AccountMemberResourcePort {
  return {
    async listLinks(workspaceId) {
      return new Map(
        listAccountMemberResourceLinks(db, workspaceId).map(({ userId, resourceId, revision }) => [
          userId,
          { resourceId, revision },
        ]),
      );
    },
    async listAvatarProjection(workspaceId) {
      return listResourceAvatarProjection(db, workspaceId);
    },
    async setLink({ workspaceId, principalId, resourceId, expectedRevision, now }) {
      const link = setAccountMemberResourceLink({
        db,
        accountId: workspaceId,
        userId: principalId,
        resourceId,
        expectedRevision,
        now,
      });
      return { resourceId: link.resourceId, revision: link.revision };
    },
    async clearLink({ workspaceId, principalId, expectedRevision }) {
      clearAccountMemberResourceLink({ db, accountId: workspaceId, userId: principalId, expectedRevision });
    },
    reconcileImportedLinks({ workspaceId, resourceIdMap, updatedAt }) {
      reconcileAccountMemberResources({ db, accountId: workspaceId, resourceIdMap, updatedAt });
    },
    removeResourceLink(workspaceId, resourceId) {
      removeAccountMemberResourceForResource(db, workspaceId, resourceId);
    },
  };
}
