import { randomUUID } from "node:crypto";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import { DEFAULT_ACCOUNT_APPLICATION } from "../auth";
import { enqueueAudit } from "../auditOutbox";
import { tx } from "../txn";
import { buildCutoverAuditEvent } from "../federatedLinkLifecycle";
import type { DeprovisionCredentialOrphanInput, CutoverRepairResult } from "../cutoverRepairTypes";

/** Deprovisions only a credential-only orphan and ends masquerade sessions after commit. */
export function deprovisionCredentialOrphan({
  db,
  administration,
  identity,
  principal,
  email,
}: DeprovisionCredentialOrphanInput): CutoverRepairResult {
  const memberships = administration
    .inspectSsoCutoverWorkspaces()
    .flatMap((workspace) => workspace.members)
    .filter((member) => member.principalId === principal.id);
  const locallyDeprovisionable =
    principal.providerIds.length === 0 ||
    (principal.providerIds.length === 1 && principal.providerIds[0] === "credential");
  if (memberships.length > 0 || !locallyDeprovisionable) {
    throw new Error(
      "The target is not a providerless or credential-only principal with zero active workspace memberships.",
    );
  }
  const auditId = randomUUID();
  const audit: AccountAuditEvent = buildCutoverAuditEvent(auditId, new Date().toISOString(), {
    applicationId: DEFAULT_ACCOUNT_APPLICATION.applicationId,
    workspaceId: null,
    actorPrincipalId: null,
    targetPrincipalId: principal.id,
    action: "identity.local_deprovisioned",
    changedFields: ["localIdentity", "credential", "sessions"],
  });
  let masqueradeHandles: readonly string[] = [];
  tx(
    db,
    () => {
      masqueradeHandles = identity.deprovisionLocalPrincipalInTx(principal.id);
      enqueueAudit(db, audit, audit.id);
    },
    "immediate",
  );
  identity.commitMasqueradeSessionEnds(masqueradeHandles);
  return {
    operation: "deprovision-credential-orphan",
    principalId: principal.id,
    email,
    providerId: null,
    subject: null,
    auditId,
  };
}
