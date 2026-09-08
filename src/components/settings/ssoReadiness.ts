import type { Role } from "@capacitylens/shared/domain/access";
import { isAccountRole } from "@capacitylens/shared/account/types";
import { isSsoReadinessReason, type SsoReadinessReason } from "@capacitylens/shared/account/ssoCutover";

/** Exact provider-row coordinate accepted by the administration repair endpoint. */
export interface ReadinessRepairLink {
  rowId: string;
  providerId: string;
  subject: string;
}

/** Validated member readiness projection rendered by Team & access. */
export interface ReadinessMember {
  principalId: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  linked: boolean;
  blocking: boolean;
  critical: boolean;
  reason: SsoReadinessReason;
  repairLinks: ReadinessRepairLink[];
}

interface ReadinessIssue {
  message: string;
  reason: SsoReadinessReason;
  blocking: boolean;
  critical: boolean;
  workspaceId: string | null;
  principalId: string | null;
}

/** Validated current-workspace view of installation-wide cutover readiness. */
export interface WorkspaceReadiness {
  ready: boolean;
  provider: { id: string; label: string; kind: "oidc"; experimental: false };
  members: ReadinessMember[];
  issues: ReadinessIssue[];
  globalIssues: ReadinessIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReadinessIssue(value: unknown): value is ReadinessIssue {
  if (!isRecord(value)) return false;
  const issue = value;
  return (
    typeof issue.message === "string" &&
    isSsoReadinessReason(issue.reason) &&
    typeof issue.blocking === "boolean" &&
    typeof issue.critical === "boolean" &&
    (issue.workspaceId === null || typeof issue.workspaceId === "string") &&
    (issue.principalId === null || typeof issue.principalId === "string")
  );
}

function isReadinessMember(value: unknown): value is ReadinessMember {
  if (!isRecord(value)) return false;
  const member = value;
  return (
    typeof member.principalId === "string" &&
    isNullableString(member.email) &&
    isNullableString(member.displayName) &&
    isAccountRole(member.role) &&
    typeof member.linked === "boolean" &&
    typeof member.blocking === "boolean" &&
    typeof member.critical === "boolean" &&
    isSsoReadinessReason(member.reason) &&
    Array.isArray(member.repairLinks) &&
    member.repairLinks.every(isReadinessRepairLink)
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isReadinessRepairLink(value: unknown): value is ReadinessRepairLink {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.rowId) && isNonEmptyString(value.providerId) && isNonEmptyString(value.subject);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isReadinessProvider(value: unknown): value is WorkspaceReadiness["provider"] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    value.kind === "oidc" &&
    value.experimental === false
  );
}

/** How a readiness row names a member: the email an administrator would act on, falling back to the
 *  display name and finally to the raw principal id — never a blank cell. Single-sourced here
 *  because the panel's rows and the unlink confirmation must name the same person the same way. */
export function resolveReadinessMemberLabel(member: ReadinessMember): string {
  return member.email ?? member.displayName ?? member.principalId;
}

/** Parse an untrusted readiness response, returning null when any nested contract field is invalid. */
export function parseWorkspaceReadiness(value: unknown): WorkspaceReadiness | null {
  if (!isRecord(value)) return null;
  const body = value;
  if (
    typeof body.ready !== "boolean" ||
    !isReadinessProvider(body.provider) ||
    !Array.isArray(body.members) ||
    !body.members.every(isReadinessMember) ||
    !Array.isArray(body.issues) ||
    !body.issues.every(isReadinessIssue) ||
    !Array.isArray(body.globalIssues) ||
    !body.globalIssues.every(isReadinessIssue)
  ) {
    return null;
  }
  return {
    ready: body.ready,
    provider: body.provider,
    members: body.members,
    issues: body.issues,
    globalIssues: body.globalIssues,
  };
}
