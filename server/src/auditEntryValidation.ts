import type { AccountAuditAction, AccountAuditEvent } from "@capacitylens/shared/account/audit";
import { isIsoInstant } from "@capacitylens/shared/account/types";
import { MASQUERADE_END_REASONS } from "@capacitylens/shared/domain/masquerade";
import { isScopedEntityKey } from "@capacitylens/shared/types/entities";
import type { AuditEntry, AuditRecord } from "./audit";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

const PRODUCT_ACTION_VALUES = [
  "create",
  "update",
  "patch",
  "delete",
  "batch",
  "import",
  "exampleData",
  "archive",
  "unarchive",
  "softDelete",
  "purge",
  "memberRole",
  "memberStatus",
  "memberAccessEnabled",
  "memberSignInTrackingChange",
  "memberRemove",
  "ownershipTransfer",
  "ownershipTransferRequest",
  "inviteCreate",
  "inviteAccept",
  "inviteRevoke",
  "passwordResetIssue",
  "sessionsRevoke",
  "memberResourceLink",
  "memberResourceChange",
  "memberResourceUnlink",
] as const satisfies readonly AuditRecord["action"][];
const ACCOUNT_ACTION_VALUES = [
  "workspace.provisioned",
  "workspace.erased",
  "invitation.created",
  "invitation.accepted",
  "invitation.revoked",
  "joining_policy.updated",
  "member.role_changed",
  "member.status_changed",
  "member.access_disabled",
  "member.access_enabled",
  "member.removed",
  "ownership.transferred",
  "ownership_transfer.initiated",
  "ownership_transfer.replaced",
  "ownership_transfer.accepted",
  "ownership_transfer.withdrawn",
  "ownership_transfer.declined",
  "ownership_transfer.cancelled",
  "ownership_transfer.expired",
  "ownership_transfer.invalidated",
  "ownership_transfer.completed",
  "identity.password_reset_issued",
  "identity.owner_recovery_issued",
  "identity.federated_linked",
  "identity.email_corrected",
  "identity.federated_link_removed",
  "identity.sessions_revoked",
  "identity.masquerade_started",
  "identity.masquerade_ended",
  "identity.sso_cutover_activated",
  "identity.local_deprovisioned",
  "flow.compensated",
  "flow.reconciliation_required",
] as const satisfies readonly AccountAuditAction[];
const ACCOUNT_OUTCOME_VALUES = [
  "success",
  "denied",
  "failed",
  "compensated",
] as const satisfies readonly AccountAuditEvent["outcome"][];

// Keep the runtime validators exhaustive when either owning union grows.
const productActionsAreExhaustive: Exclude<AuditRecord["action"], (typeof PRODUCT_ACTION_VALUES)[number]> extends never
  ? true
  : never = true;
const accountActionsAreExhaustive: Exclude<AccountAuditAction, (typeof ACCOUNT_ACTION_VALUES)[number]> extends never
  ? true
  : never = true;
const accountOutcomesAreExhaustive: Exclude<
  AccountAuditEvent["outcome"],
  (typeof ACCOUNT_OUTCOME_VALUES)[number]
> extends never
  ? true
  : never = true;
void productActionsAreExhaustive;
void accountActionsAreExhaustive;
void accountOutcomesAreExhaustive;

const PRODUCT_ACTIONS = new Set<string>(PRODUCT_ACTION_VALUES);
const ACCOUNT_ACTIONS = new Set<string>(ACCOUNT_ACTION_VALUES);
const ACCOUNT_OUTCOMES = new Set<string>(ACCOUNT_OUTCOME_VALUES);
const MASQUERADE_END_REASON_SET = new Set<string>(MASQUERADE_END_REASONS);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isCascadeCounts(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([table, count]) => isScopedEntityKey(table) && Number.isInteger(count) && (count as number) > 0,
  );
}

function isProductAuditEntry(row: Record<string, unknown>): boolean {
  const productAction = isNonEmptyString(row.action) && PRODUCT_ACTIONS.has(row.action);
  return (
    isIsoInstant(row.ts) &&
    isNonEmptyString(row.userId) &&
    isNonEmptyString(row.accountId) &&
    isNonEmptyString(row.entity) &&
    isNonEmptyString(row.id) &&
    productAction &&
    (row.action === "purge" ? isCascadeCounts(row.cascadeCounts) : row.cascadeCounts === undefined)
  );
}

function hasValidAccountAuditFields(row: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(row.id) &&
    isIsoInstant(row.occurredAt) &&
    isNonEmptyString(row.applicationId) &&
    isNullableNonEmptyString(row.workspaceId) &&
    isNullableNonEmptyString(row.actorPrincipalId) &&
    isNullableNonEmptyString(row.targetPrincipalId) &&
    isNullableNonEmptyString(row.commandId) &&
    isNonEmptyString(row.action) &&
    ACCOUNT_ACTIONS.has(row.action) &&
    isNonEmptyString(row.outcome) &&
    ACCOUNT_OUTCOMES.has(row.outcome)
  );
}

function hasValidAccountActionDetails(row: Record<string, unknown>): boolean {
  if (row.action === "identity.masquerade_started") {
    return isIsoInstant(row.expiresAt) && row.reason === undefined;
  }
  if (row.action === "identity.masquerade_ended") {
    return isNonEmptyString(row.reason) && MASQUERADE_END_REASON_SET.has(row.reason) && row.expiresAt === undefined;
  }
  return row.expiresAt === undefined && row.reason === undefined;
}

/** Checks whether an unknown payload has the supported audit-entry shape. */
export function isAuditEntry(value: unknown): value is AuditEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (!isStringArray(row.changedFields)) return false;
  if ("ts" in row) return isProductAuditEntry(row);
  if (!hasValidAccountAuditFields(row)) return false;
  return hasValidAccountActionDetails(row);
}
