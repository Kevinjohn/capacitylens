import { randomUUID } from "node:crypto";
import { DEFAULT_ACCOUNT_APPLICATION } from "../auth";
import { enqueueAudit } from "../auditOutbox";
import { tx } from "../txn";
import { eraseWorkspaceProductDataInTx } from "../erasure";
import { eraseWorkspaceCommandHistoryInTx } from "../accounts/state";
import { buildCutoverAuditEvent } from "../federatedLinkLifecycle";
import type { EraseEmptyWorkspaceInput, CutoverRepairResult } from "../cutoverRepairTypes";

/**
 * Erases an empty workspace and records its audit event atomically.
 * The caller must hold the stopped-server exclusive lock across the preceding membership check.
 */
export function eraseEmptyWorkspace({ db, administration, operation }: EraseEmptyWorkspaceInput): CutoverRepairResult {
  const workspace = administration
    .inspectSsoCutoverWorkspaces()
    .find((candidate) => candidate.workspaceId === operation.workspaceId);
  if (!workspace) throw new Error("No workspace matches that exact id.");
  if (workspace.members.length > 0) throw new Error("Only a workspace with zero active members can be erased.");
  const occurredAt = new Date().toISOString();
  const auditId = randomUUID();
  tx(
    db,
    () => {
      eraseWorkspaceProductDataInTx(db, workspace.workspaceId);
      administration.eraseWorkspaceAdministrationInTx(workspace.workspaceId);
      eraseWorkspaceCommandHistoryInTx(db, workspace.workspaceId);
      enqueueAudit(
        db,
        buildCutoverAuditEvent(auditId, occurredAt, {
          applicationId: DEFAULT_ACCOUNT_APPLICATION.applicationId,
          workspaceId: workspace.workspaceId,
          actorPrincipalId: null,
          targetPrincipalId: null,
          action: "workspace.erased",
          changedFields: ["workspace", "memberships"],
        }),
        auditId,
      );
    },
    "immediate",
  );
  return { operation: operation.kind, principalId: null, email: null, providerId: null, subject: null, auditId };
}
