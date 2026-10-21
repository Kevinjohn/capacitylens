import { randomUUID } from "node:crypto";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import { DEFAULT_ACCOUNT_APPLICATION } from "../auth";
import { buildCutoverAuditEvent } from "../federatedLinkLifecycle";
import type { RemoveProviderLinkInput, CutoverRepairResult } from "../cutoverRepairTypes";

/** Removes only the resolved provider row and records that exact identity change. */
export async function removeProviderLink({
  identity,
  configuredProviderId,
  principal,
  email,
  facts,
  operation,
}: RemoveProviderLinkInput): Promise<CutoverRepairResult> {
  const links = [
    ...facts.requiredProviderLinks.map((link) => ({ ...link, providerId: configuredProviderId })),
    ...facts.alternativeProviderLinks,
  ].filter(
    (link) =>
      link.principalId === principal.id &&
      link.providerId === operation.providerId &&
      link.subject === operation.subject,
  );
  if (links.length !== 1) {
    throw new Error("The email, provider id, and exact subject do not resolve one provider link.");
  }
  const link = links[0];
  if (!link) throw new Error("The provider link disappeared before repair completed.");
  const auditId = randomUUID();
  const audit: AccountAuditEvent = buildCutoverAuditEvent(auditId, new Date().toISOString(), {
    applicationId: DEFAULT_ACCOUNT_APPLICATION.applicationId,
    workspaceId: null,
    actorPrincipalId: null,
    targetPrincipalId: principal.id,
    action: "identity.federated_link_removed",
    changedFields: ["federatedIdentity", "sessions"],
  });
  const changed = await identity.removeFederatedLinkForStoppedRepair({
    principalId: principal.id,
    providerId: operation.providerId,
    rowId: link.rowId,
    subject: link.subject,
    audit,
  });
  if (!changed) throw new Error("The provider link disappeared before repair completed.");
  return {
    operation: operation.kind,
    principalId: principal.id,
    email,
    providerId: operation.providerId,
    subject: operation.subject,
    auditId,
  };
}
