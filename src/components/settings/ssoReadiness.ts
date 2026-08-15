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

function isReadinessIssue(value: unknown): value is ReadinessIssue {
  if (!value || typeof value !== "object") return false;
  const issue = value as Record<string, unknown>;
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
  if (!value || typeof value !== "object") return false;
  const member = value as Record<string, unknown>;
  return (
    typeof member.principalId === "string" &&
    (member.email === null || typeof member.email === "string") &&
    (member.displayName === null || typeof member.displayName === "string") &&
    isAccountRole(member.role) &&
    typeof member.linked === "boolean" &&
    typeof member.blocking === "boolean" &&
    typeof member.critical === "boolean" &&
    isSsoReadinessReason(member.reason) &&
    Array.isArray(member.repairLinks) &&
    member.repairLinks.every((link) => {
      if (!link || typeof link !== "object") return false;
      const coordinate = link as Record<string, unknown>;
      return (
        typeof coordinate.rowId === "string" &&
        coordinate.rowId.length > 0 &&
        typeof coordinate.providerId === "string" &&
        coordinate.providerId.length > 0 &&
        typeof coordinate.subject === "string" &&
        coordinate.subject.length > 0
      );
    })
  );
}

/** How a readiness row names a member: the email an administrator would act on, falling back to the
 *  display name and finally to the raw principal id — never a blank cell. Single-sourced here
 *  because the panel's rows and the unlink confirmation must name the same person the same way. */
export function readinessMemberLabel(member: ReadinessMember): string {
  return member.email ?? member.displayName ?? member.principalId;
}

/** Parse an untrusted readiness response, returning null when any nested contract field is invalid. */
export function parseWorkspaceReadiness(value: unknown): WorkspaceReadiness | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const provider = body.provider as Record<string, unknown> | null;
  if (
    typeof body.ready !== "boolean" ||
    !provider ||
    typeof provider.id !== "string" ||
    typeof provider.label !== "string" ||
    provider.kind !== "oidc" ||
    provider.experimental !== false ||
    !Array.isArray(body.members) ||
    !body.members.every(isReadinessMember) ||
    !Array.isArray(body.issues) ||
    !body.issues.every(isReadinessIssue) ||
    !Array.isArray(body.globalIssues) ||
    !body.globalIssues.every(isReadinessIssue)
  ) {
    return null;
  }
  return body as unknown as WorkspaceReadiness;
}
