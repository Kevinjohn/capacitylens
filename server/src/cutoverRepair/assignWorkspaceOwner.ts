import { randomUUID } from "node:crypto";
import { DEFAULT_ACCOUNT_APPLICATION } from "../auth";
import { enqueueAudit } from "../auditOutbox";
import { tx } from "../txn";
import { buildCutoverAuditEvent } from "../federatedLinkLifecycle";
import type { AssignWorkspaceOwnerInput, CutoverRepairResult } from "../cutoverRepairTypes";

/** Rechecks the ownerless membership target in the same transaction as its audit event. */
export function assignWorkspaceOwner({
  db,
  administration,
  principal,
  email,
  operation,
}: AssignWorkspaceOwnerInput): CutoverRepairResult {
  const workspace = administration
    .inspectSsoCutoverWorkspaces()
    .find((candidate) => candidate.workspaceId === operation.workspaceId);
  if (!workspace) throw new Error("No workspace matches that exact id.");
  if (workspace.members.some((member) => member.role === "owner")) {
    throw new Error("The workspace already has an active Owner.");
  }
  if (!workspace.members.some((member) => member.principalId === principal.id)) {
    throw new Error("The selected identity is not an active member of that workspace.");
  }
  const occurredAt = new Date().toISOString();
  const auditId = randomUUID();
  tx(
    db,
    () => {
      if (!administration.repairOwnerlessWorkspaceInTx(workspace.workspaceId, principal.id)) {
        throw new Error("The owner repair target changed before commit.");
      }
      enqueueAudit(
        db,
        buildCutoverAuditEvent(auditId, occurredAt, {
          applicationId: DEFAULT_ACCOUNT_APPLICATION.applicationId,
          workspaceId: workspace.workspaceId,
          actorPrincipalId: null,
          targetPrincipalId: principal.id,
          action: "member.role_changed",
          changedFields: ["role"],
        }),
        auditId,
      );
    },
    "immediate",
  );
  return { operation: operation.kind, principalId: principal.id, email, providerId: null, subject: null, auditId };
}
