import type { Role } from "@capacitylens/shared/account/types";
import type { SsoReadinessReason } from "@capacitylens/shared/account/ssoCutover";
import type { AuthProviderInfo } from "../auth";
import type { SsoCutoverIdentityPort, SsoCutoverIdentityFacts } from "./betterAuthIdentityPort";
import type { SsoCutoverAccountAdminPort, SsoCutoverWorkspaceFact } from "./sqliteAccountAdminPort";

/** Exact provider coordinate that a repair action must confirm before deleting one row. */
export interface SsoReadinessRepairLink {
  rowId: string;
  providerId: string;
  subject: string;
}

/** Readiness of one active workspace member. */
export interface SsoReadinessMember {
  principalId: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  linked: boolean;
  blocking: boolean;
  critical: boolean;
  reason: SsoReadinessReason;
  repairLinks: readonly SsoReadinessRepairLink[];
}

/** One stable readiness finding. Revocable findings remain visible without blocking activation. */
export interface SsoReadinessIssue {
  reason: SsoReadinessReason;
  message: string;
  blocking: boolean;
  critical: boolean;
  workspaceId: string | null;
  principalId: string | null;
}

/** One workspace's readiness projection. */
export interface SsoWorkspaceReadiness {
  workspaceId: string;
  workspaceName: string;
  ready: boolean;
  members: readonly SsoReadinessMember[];
  issues: readonly SsoReadinessIssue[];
}

/** Installation-wide strict-OIDC cutover projection. */
export interface SsoCutoverReadiness {
  ready: boolean;
  provider: AuthProviderInfo;
  workspaces: readonly SsoWorkspaceReadiness[];
  issues: readonly SsoReadinessIssue[];
}

interface ReadinessIndexes {
  principalById: ReadonlyMap<string, SsoCutoverIdentityFacts["principals"][number]>;
  requiredByPrincipal: ReadonlyMap<string, SsoCutoverIdentityFacts["requiredProviderLinks"]>;
  unsupportedAlternativeByPrincipal: ReadonlyMap<string, SsoCutoverIdentityFacts["alternativeProviderLinks"]>;
  duplicateSubjects: ReadonlySet<string>;
}

function memberReadiness(
  member: SsoCutoverWorkspaceFact["members"][number],
  indexes: ReadinessIndexes,
  provider: AuthProviderInfo,
): SsoReadinessMember {
  const principal = indexes.principalById.get(member.principalId);
  const links = indexes.requiredByPrincipal.get(member.principalId) ?? [];
  const unsupportedAlternatives = indexes.unsupportedAlternativeByPrincipal.get(member.principalId) ?? [];
  const duplicateSubject = links.some((link) => indexes.duplicateSubjects.has(link.subject));
  const reason: SsoReadinessReason = !principal
    ? "principal_missing"
    : unsupportedAlternatives.length > 0
      ? "alternative_provider_linked"
      : links.length === 0
        ? "member_not_linked"
        : links.length > 1
          ? "multiple_required_provider_links"
          : duplicateSubject
            ? "duplicate_provider_subject"
            : !links[0]!.verified
              ? "unverified_provider_link"
              : "ready";
  return {
    principalId: member.principalId,
    email: principal?.email ?? null,
    displayName: principal?.displayName ?? null,
    role: member.role,
    // Repair UI must remain able to remove an invalid or duplicated link set. `linked` means that
    // at least one required-provider row exists; readiness separately requires exactly one.
    linked: links.length > 0,
    blocking: reason !== "ready",
    critical: member.role === "owner" || !["ready", "member_not_linked"].includes(reason),
    reason,
    repairLinks: (reason === "alternative_provider_linked" ? unsupportedAlternatives : links).map((link) => ({
      rowId: link.rowId,
      providerId: "providerId" in link ? link.providerId : provider.id,
      subject: link.subject,
    })),
  };
}

function memberLabel(member: SsoReadinessMember): string {
  return `${member.email ?? member.displayName ?? member.principalId} (${member.role})`;
}

/** Evaluate immutable workspace and identity facts without performing repairs or cleanup. */
export function evaluateSsoCutoverReadiness(input: {
  provider: AuthProviderInfo;
  providers: readonly AuthProviderInfo[];
  workspaces: readonly SsoCutoverWorkspaceFact[];
  identity: SsoCutoverIdentityFacts;
  openSignup: boolean;
}): SsoCutoverReadiness {
  const { provider, workspaces, identity } = input;
  const principalById = new Map(identity.principals.map((principal) => [principal.id, principal] as const));
  const requiredByPrincipal = new Map<string, SsoCutoverIdentityFacts["requiredProviderLinks"]>();
  for (const link of identity.requiredProviderLinks) {
    requiredByPrincipal.set(link.principalId, [...(requiredByPrincipal.get(link.principalId) ?? []), link]);
  }
  const subjectsByPrincipal = new Map<string, Set<string>>();
  for (const link of identity.requiredProviderLinks) {
    const principals = subjectsByPrincipal.get(link.subject) ?? new Set<string>();
    principals.add(link.principalId);
    subjectsByPrincipal.set(link.subject, principals);
  }
  const duplicateSubjects = new Set(
    [...subjectsByPrincipal].filter(([, principals]) => principals.size > 1).map(([subject]) => subject),
  );
  const configuredProviderIds = new Set(input.providers.map(({ id }) => id));
  const unsupportedAlternativeByPrincipal = new Map<string, SsoCutoverIdentityFacts["alternativeProviderLinks"]>();
  for (const link of identity.alternativeProviderLinks) {
    if (configuredProviderIds.has(link.providerId)) continue;
    unsupportedAlternativeByPrincipal.set(link.principalId, [
      ...(unsupportedAlternativeByPrincipal.get(link.principalId) ?? []),
      link,
    ]);
  }
  const indexes: ReadinessIndexes = {
    principalById,
    requiredByPrincipal,
    unsupportedAlternativeByPrincipal,
    duplicateSubjects,
  };
  const globalIssues: SsoReadinessIssue[] = [];
  if (input.openSignup) {
    globalIssues.push({
      reason: "open_signup_enabled",
      message: "Open password signup is enabled and must be disabled before cutover.",
      blocking: true,
      critical: true,
      workspaceId: null,
      principalId: null,
    });
  }
  const memberPrincipalIds = new Set(
    workspaces.flatMap((workspace) => workspace.members.map((member) => member.principalId)),
  );
  for (const [principalId, links] of unsupportedAlternativeByPrincipal) {
    if (memberPrincipalIds.has(principalId)) continue;
    const principal = principalById.get(principalId);
    const coordinates = links.map((link) => `${link.providerId}:${link.subject}`).join(", ");
    globalIssues.push({
      reason: "alternative_provider_linked",
      message:
        `${principal?.email ?? principalId} has ${links.length} link(s) to an unconfigured identity provider; ` +
        `repair coordinates: ${coordinates}.`,
      blocking: true,
      critical: true,
      workspaceId: null,
      principalId,
    });
  }
  for (const principal of identity.principals) {
    if (memberPrincipalIds.has(principal.id)) continue;
    const unverifiedRequiredLinks = (requiredByPrincipal.get(principal.id) ?? []).filter((link) => !link.verified);
    for (const link of unverifiedRequiredLinks) {
      globalIssues.push({
        reason: "unverified_provider_link",
        message:
          `${principal.email} has an unverified ${provider.id} link with subject ${link.subject} ` +
          "and no active workspace membership.",
        blocking: true,
        critical: true,
        workspaceId: null,
        principalId: principal.id,
      });
    }
    const alternativeProviderIds = principal.providerIds.filter(
      (providerId) => providerId !== "credential" && providerId !== provider.id,
    );
    if ((requiredByPrincipal.get(principal.id) ?? []).length === 0 && alternativeProviderIds.length > 0) {
      globalIssues.push({
        reason: "member_not_linked",
        message:
          `${principal.email} has no ${provider.id} link and no active workspace membership; ` +
          `alternative provider(s): ${alternativeProviderIds.join(", ")}.`,
        blocking: true,
        critical: true,
        workspaceId: null,
        principalId: principal.id,
      });
    }
    if (principal.providerIds.length === 0) {
      globalIssues.push({
        reason: "providerless_orphan",
        message: `${principal.email} is a providerless principal with no active workspace membership.`,
        blocking: true,
        critical: true,
        workspaceId: null,
        principalId: principal.id,
      });
    } else if (principal.providerIds.length === 1 && principal.providerIds[0] === "credential") {
      globalIssues.push({
        reason: "credential_only_orphan",
        message: `${principal.email} is a credential-only principal with no active workspace membership.`,
        blocking: true,
        critical: true,
        workspaceId: null,
        principalId: principal.id,
      });
    }
  }
  for (const principalId of identity.outstandingResetPrincipalIds) {
    const principal = principalById.get(principalId);
    globalIssues.push({
      reason: "outstanding_password_reset",
      message: `${principal?.email ?? principalId} has an outstanding password or identity verification ceremony that cutover will revoke.`,
      blocking: false,
      critical: false,
      workspaceId: null,
      principalId,
    });
  }

  const evaluatedWorkspaces = workspaces.map((workspace): SsoWorkspaceReadiness => {
    const members = workspace.members
      .map((member) => memberReadiness(member, indexes, provider))
      .sort(
        (left, right) =>
          Number(right.critical && right.blocking) - Number(left.critical && left.blocking) ||
          Number(right.blocking) - Number(left.blocking) ||
          left.principalId.localeCompare(right.principalId),
      );
    const issues: SsoReadinessIssue[] = [];
    if (members.length === 0) {
      issues.push({
        reason: "workspace_has_no_members",
        message: `${workspace.workspaceName} (${workspace.workspaceId}) has no active members.`,
        blocking: true,
        critical: true,
        workspaceId: workspace.workspaceId,
        principalId: null,
      });
    }
    if (!members.some((member) => member.role === "owner")) {
      issues.push({
        reason: "workspace_has_no_owner",
        message: `${workspace.workspaceName} (${workspace.workspaceId}) has no active Owner.`,
        blocking: true,
        critical: true,
        workspaceId: workspace.workspaceId,
        principalId: null,
      });
    }
    for (const member of members.filter((candidate) => candidate.blocking)) {
      issues.push({
        reason: member.reason,
        message: `${memberLabel(member)} is not ready for strict OIDC cutover (${member.reason}).`,
        blocking: true,
        critical: member.critical,
        workspaceId: workspace.workspaceId,
        principalId: member.principalId,
      });
    }
    return {
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      ready: !issues.some((issue) => issue.blocking),
      members,
      issues,
    };
  });

  const issues = [...globalIssues, ...evaluatedWorkspaces.flatMap((workspace) => workspace.issues)].sort(
    (left, right) => Number(right.critical) - Number(left.critical) || left.message.localeCompare(right.message),
  );
  return { ready: !issues.some((issue) => issue.blocking), provider, workspaces: evaluatedWorkspaces, issues };
}

/** Read all input facts inside one database snapshot and evaluate installation readiness. */
export function ssoCutoverReadiness(input: {
  provider: AuthProviderInfo;
  providers: readonly AuthProviderInfo[];
  identity: SsoCutoverIdentityPort;
  administration: SsoCutoverAccountAdminPort;
  openSignup: boolean;
}): SsoCutoverReadiness {
  return input.identity.readSsoCutoverSnapshot(() =>
    evaluateSsoCutoverReadiness({
      provider: input.provider,
      providers: input.providers,
      workspaces: input.administration.inspectSsoCutoverWorkspaces(),
      identity: input.identity.inspectSsoCutover(input.provider.id),
      openSignup: input.openSignup,
    }),
  );
}

/** Format all readiness issues for a stack-free startup refusal. */
export function formatSsoCutoverRefusal(readiness: SsoCutoverReadiness): string {
  return readiness.issues.map((issue) => issue.message).join(" ");
}
