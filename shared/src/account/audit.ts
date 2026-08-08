import type { ApplicationId, CommandId, IsoInstant, PrincipalId, WorkspaceId } from "./types";

export type AccountAuditAction =
  | "workspace.provisioned"
  | "workspace.erased"
  | "invitation.created"
  | "invitation.accepted"
  | "invitation.revoked"
  | "member.role_changed"
  | "member.removed"
  | "ownership.transferred"
  | "identity.password_reset_issued"
  | "identity.owner_recovery_issued"
  | "identity.federated_linked"
  | "identity.email_corrected"
  | "identity.federated_link_removed"
  | "identity.sessions_revoked"
  | "identity.sso_cutover_activated"
  | "identity.local_deprovisioned"
  | "flow.compensated"
  | "flow.reconciliation_required";

export interface AccountAuditEvent {
  id: string;
  occurredAt: IsoInstant;
  applicationId: ApplicationId;
  workspaceId: WorkspaceId | null;
  actorPrincipalId: PrincipalId | null;
  targetPrincipalId: PrincipalId | null;
  commandId: CommandId | null;
  action: AccountAuditAction;
  outcome: "success" | "denied" | "failed" | "compensated";
  changedFields: readonly string[];
}
