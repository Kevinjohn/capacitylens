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

function memberReadinessReason(input: {
  principalExists: boolean;
  requiredLinks: SsoCutoverIdentityFacts["requiredProviderLinks"];
  unsupportedAlternatives: SsoCutoverIdentityFacts["alternativeProviderLinks"];
  duplicateSubject: boolean;
}): SsoReadinessReason {
  const { principalExists, requiredLinks, unsupportedAlternatives, duplicateSubject } = input;
  if (!principalExists) return "principal_missing";
  if (unsupportedAlternatives.length > 0) return "alternative_provider_linked";
  if (requiredLinks.length === 0) return "member_not_linked";
  if (requiredLinks.length > 1) return "multiple_required_provider_links";
  if (duplicateSubject) return "duplicate_provider_subject";
  if (requiredLinks[0]?.verified !== true) return "unverified_provider_link";
  return "ready";
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
  const reason = memberReadinessReason({
    principalExists: principal !== undefined,
    requiredLinks: links,
    unsupportedAlternatives,
    duplicateSubject,
  });
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

function indexLinksByPrincipal<Link extends { principalId: string }>(links: readonly Link[]): Map<string, Link[]> {
  const linksByPrincipal = new Map<string, Link[]>();
  for (const link of links) {
    linksByPrincipal.set(link.principalId, [...(linksByPrincipal.get(link.principalId) ?? []), link]);
  }
  return linksByPrincipal;
}

function readinessIndexes(identity: SsoCutoverIdentityFacts, providers: readonly AuthProviderInfo[]): ReadinessIndexes {
  const principalById = new Map<string, SsoCutoverIdentityFacts["principals"][number]>();
  for (const principal of identity.principals) principalById.set(principal.id, principal);
  const requiredByPrincipal = indexLinksByPrincipal(identity.requiredProviderLinks);
  const subjectsByPrincipal = new Map<string, Set<string>>();
  for (const link of identity.requiredProviderLinks) {
    const principals = subjectsByPrincipal.get(link.subject) ?? new Set<string>();
    principals.add(link.principalId);
    subjectsByPrincipal.set(link.subject, principals);
  }
  const duplicateSubjects = new Set(
    [...subjectsByPrincipal].filter(([, principals]) => principals.size > 1).map(([subject]) => subject),
  );
  const configuredProviderIds = new Set(providers.map(({ id }) => id));
  const unsupportedAlternativeByPrincipal = indexLinksByPrincipal(
    identity.alternativeProviderLinks.filter((link) => !configuredProviderIds.has(link.providerId)),
  );
  return { principalById, requiredByPrincipal, unsupportedAlternativeByPrincipal, duplicateSubjects };
}

function orphanIssues(
  input: { identity: SsoCutoverIdentityFacts; provider: AuthProviderInfo },
  indexes: ReadinessIndexes,
  memberPrincipalIds: ReadonlySet<string>,
): SsoReadinessIssue[] {
  const { identity, provider } = input;
  const issues: SsoReadinessIssue[] = [];
  for (const principal of identity.principals) {
    if (memberPrincipalIds.has(principal.id)) continue;
    const requiredLinks = indexes.requiredByPrincipal.get(principal.id) ?? [];
    for (const link of requiredLinks.filter((candidate) => !candidate.verified)) {
      issues.push({
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
    if (requiredLinks.length === 0 && alternativeProviderIds.length > 0) {
      issues.push({
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
      issues.push({
        reason: "providerless_orphan",
        message: `${principal.email} is a providerless principal with no active workspace membership.`,
        blocking: true,
        critical: true,
        workspaceId: null,
        principalId: principal.id,
      });
    } else if (principal.providerIds.length === 1 && principal.providerIds[0] === "credential") {
      issues.push({
        reason: "credential_only_orphan",
        message: `${principal.email} is a credential-only principal with no active workspace membership.`,
        blocking: true,
        critical: true,
        workspaceId: null,
        principalId: principal.id,
      });
    }
  }
  return issues;
}

function globalReadinessIssues(
  input: {
    provider: AuthProviderInfo;
    identity: SsoCutoverIdentityFacts;
    openSignup: boolean;
  },
  indexes: ReadinessIndexes,
  memberPrincipalIds: ReadonlySet<string>,
): SsoReadinessIssue[] {
  const issues: SsoReadinessIssue[] = [];
  if (input.openSignup) {
    issues.push({
      reason: "open_signup_enabled",
      message: "Open password signup is enabled and must be disabled before cutover.",
      blocking: true,
      critical: true,
      workspaceId: null,
      principalId: null,
    });
  }
  for (const [principalId, links] of indexes.unsupportedAlternativeByPrincipal) {
    if (memberPrincipalIds.has(principalId)) continue;
    const principal = indexes.principalById.get(principalId);
    const coordinates = links.map((link) => `${link.providerId}:${link.subject}`).join(", ");
    issues.push({
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
  issues.push(...orphanIssues(input, indexes, memberPrincipalIds));
  for (const principalId of input.identity.outstandingResetPrincipalIds) {
    const principal = indexes.principalById.get(principalId);
    issues.push({
      reason: "outstanding_password_reset",
      message: `${principal?.email ?? principalId} has an outstanding password or identity verification ceremony that cutover will revoke.`,
      blocking: false,
      critical: false,
      workspaceId: null,
      principalId,
    });
  }
  return issues;
}

function workspaceReadiness(
  workspace: SsoCutoverWorkspaceFact,
  indexes: ReadinessIndexes,
  provider: AuthProviderInfo,
): SsoWorkspaceReadiness {
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
  const indexes = readinessIndexes(identity, input.providers);
  const memberPrincipalIds = new Set(
    workspaces.flatMap((workspace) => workspace.members.map((member) => member.principalId)),
  );
  const globalIssues = globalReadinessIssues(input, indexes, memberPrincipalIds);
  const evaluatedWorkspaces = workspaces.map((workspace) => workspaceReadiness(workspace, indexes, provider));

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
