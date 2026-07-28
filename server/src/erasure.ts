import type { Db } from "./db";
import { deleteRow } from "./db";
import { forgetWorkspaceSyncProvenance } from "./syncOrdering";

interface CrossTenantErasureEdge {
  relationship: string;
  parentId: string;
  childId: string;
  childAccountId: string;
}

/**
 * Every product FK whose parent deletion can mutate its child through CASCADE or SET NULL.
 *
 * The schema's id-only foreign keys cannot express the account boundary. Normal writes validate
 * it, but an operator repair, old migration or restored corrupt database can still contain a child
 * labelled for another account. Deleting the parent account would then silently delete or unbind
 * that other account's row. Keep this list beside the erasure boundary and in the same order as the
 * relationships documented in tables.ts.
 */
const CROSS_TENANT_ERASURE_EDGE_SQL = `
  SELECT 'resources.disciplineId -> disciplines.id' AS relationship,
         parent.id AS parentId, child.id AS childId, child.accountId AS childAccountId
    FROM disciplines AS parent
    JOIN resources AS child ON child.disciplineId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'projects.clientId -> clients.id', parent.id, child.id, child.accountId
    FROM clients AS parent
    JOIN projects AS child ON child.clientId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'phases.projectId -> projects.id', parent.id, child.id, child.accountId
    FROM projects AS parent
    JOIN phases AS child ON child.projectId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'resources.projectId -> projects.id', parent.id, child.id, child.accountId
    FROM projects AS parent
    JOIN resources AS child ON child.projectId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'activities.projectId -> projects.id', parent.id, child.id, child.accountId
    FROM projects AS parent
    JOIN activities AS child ON child.projectId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'activities.phaseId -> phases.id', parent.id, child.id, child.accountId
    FROM phases AS parent
    JOIN activities AS child ON child.phaseId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'allocations.resourceId -> resources.id', parent.id, child.id, child.accountId
    FROM resources AS parent
    JOIN allocations AS child ON child.resourceId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'allocations.activityId -> activities.id', parent.id, child.id, child.accountId
    FROM activities AS parent
    JOIN allocations AS child ON child.activityId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  UNION ALL
  SELECT 'timeOff.resourceId -> resources.id', parent.id, child.id, child.accountId
    FROM resources AS parent
    JOIN timeOff AS child ON child.resourceId = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1
  LIMIT 1
`;

export class TenantErasureIntegrityError extends Error {
  constructor(
    readonly workspaceId: string,
    readonly edge: CrossTenantErasureEdge,
  ) {
    super(
      `Workspace erasure refused: ${edge.relationship} crosses from workspace ` +
        `"${workspaceId}" to "${edge.childAccountId}" (parent "${edge.parentId}", child "${edge.childId}").`,
    );
    this.name = "TenantErasureIntegrityError";
  }
}

function assertErasureStaysWithinWorkspace(db: Db, workspaceId: string): void {
  const edge = db.prepare(CROSS_TENANT_ERASURE_EDGE_SQL).get(workspaceId) as CrossTenantErasureEdge | undefined;
  if (edge) throw new TenantErasureIntegrityError(workspaceId, edge);
}

/**
 * Delete the product-owned workspace row inside an existing transaction.
 *
 * The product foreign-key cascade removes CapacityLens-scoped data. Memberships, invitations,
 * command history and installation-local identities are deliberately outside this module and are
 * erased through the account-administration and identity adapters by `AccountFlows`.
 */
export function eraseWorkspaceProductDataInTx(db: Db, workspaceId: string): void {
  if (!db.isTransaction) {
    throw new Error("Workspace product-data erasure must run inside an existing transaction.");
  }
  assertErasureStaysWithinWorkspace(db, workspaceId);
  forgetWorkspaceSyncProvenance(db, workspaceId);
  deleteRow(db, "accounts", workspaceId);
}
