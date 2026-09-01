import type { ApplicationId, CommandId, IsoInstant, PrincipalId, WorkspaceId } from "./types";
import type { MasqueradeEndReason } from "../domain/masquerade";

export type AccountAuditAction =
  | "workspace.provisioned"
  | "workspace.erased"
  | "invitation.created"
  | "invitation.accepted"
  | "invitation.revoked"
  | "member.role_changed"
  | "member.status_changed"
  | "member.removed"
  | "ownership.transferred"
  | "identity.password_reset_issued"
  | "identity.owner_recovery_issued"
  | "identity.federated_linked"
  | "identity.email_corrected"
  | "identity.federated_link_removed"
  | "identity.sessions_revoked"
  | "identity.masquerade_started"
  | "identity.masquerade_ended"
  | "identity.sso_cutover_activated"
  | "identity.local_deprovisioned"
  | "flow.compensated"
  | "flow.reconciliation_required";

/** Audit actions whose event shape has no masquerade-specific metadata. */
export type StandardAccountAuditAction = Exclude<
  AccountAuditAction,
  "identity.masquerade_started" | "identity.masquerade_ended"
>;

interface AccountAuditEventBase {
  id: string;
  occurredAt: IsoInstant;
  applicationId: ApplicationId;
  workspaceId: WorkspaceId | null;
  actorPrincipalId: PrincipalId | null;
  targetPrincipalId: PrincipalId | null;
  commandId: CommandId | null;
  outcome: "success" | "denied" | "failed" | "compensated";
  changedFields: readonly string[];
}

/** Durable account-boundary audit events. Masquerade lifecycle actions carry the fields needed to
 * bound or explain the temporary projection; every unrelated action structurally excludes them. */
export type AccountAuditEvent =
  | (AccountAuditEventBase & {
      action: "identity.masquerade_started";
      expiresAt: IsoInstant;
      reason?: never;
    })
  | (AccountAuditEventBase & {
      action: "identity.masquerade_ended";
      reason: MasqueradeEndReason;
      expiresAt?: never;
    })
  | (AccountAuditEventBase & {
      action: StandardAccountAuditAction;
      expiresAt?: never;
      reason?: never;
    });
