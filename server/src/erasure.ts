import type { Db } from "./db";
import { deleteRow } from "./db";
import { forgetWorkspaceSyncProvenance } from "./syncOrdering";
import { TENANT_RELATIONSHIPS } from "./tenantIntegrity";

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
 * that other account's row. Built from tenantIntegrity's canonical TENANT_RELATIONSHIPS list (same
 * order as the relationships documented in tables.ts) — mirrors its crossTenantEdgeSql generator,
 * scoped here to the one workspace being erased instead of the whole database.
 */
export const CROSS_TENANT_ERASURE_EDGE_SQL =
  TENANT_RELATIONSHIPS.map(
    (relationship) => `
  SELECT '${relationship.childTable}.${relationship.parentColumn} -> ${relationship.parentTable}.id' AS relationship,
         parent.id AS parentId, child.id AS childId, child.accountId AS childAccountId
    FROM ${relationship.parentTable} AS parent
    JOIN ${relationship.childTable} AS child ON child.${relationship.parentColumn} = parent.id
   WHERE parent.accountId = ?1 AND child.accountId <> ?1`,
  ).join("\n  UNION ALL") + "\n  LIMIT 1";

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
