import type { SsoCutoverIdentityPort, SsoCutoverIdentityFacts } from "./betterAuthIdentityPort";
import type { SsoCutoverAccountAdminPort, SsoCutoverWorkspaceFact } from "./sqliteAccountAdminPort";

export type SsoCompanyProviderReadinessReason =
  | "company_provider_not_configured"
  | "principal_not_connected"
  | "workspace_has_no_members"
  | "workspace_has_no_owner"
  | "workspace_member_not_connected";

/** One finding from the authoritative multi-provider startup interlock. */
export interface SsoCompanyProviderReadinessIssue {
  reason: SsoCompanyProviderReadinessReason;
  message: string;
  blocking: true;
  workspaceId: string | null;
  principalId: string | null;
}

/** Authoritative activation readiness using the rules enforced by startup. */
export interface SsoCompanyProviderReadiness {
  ready: boolean;
  issues: readonly SsoCompanyProviderReadinessIssue[];
}

/** Evaluate the exact multi-provider readiness rules enforced by startup from one snapshot. */
export function evaluateCompanyProviderCutoverReadiness(input: {
  providerIds: ReadonlySet<string>;
  providerSnapshots: readonly { providerId: string; identity: SsoCutoverIdentityFacts }[];
  workspaces: readonly SsoCutoverWorkspaceFact[];
}): SsoCompanyProviderReadiness {
  if (input.providerIds.size === 0) {
    return {
      ready: false,
      issues: [
        {
          reason: "company_provider_not_configured",
          message: "Provider-required mode has no configured company provider.",
          blocking: true,
          workspaceId: null,
          principalId: null,
        },
      ],
    };
  }
  const first = input.providerSnapshots[0]?.identity;
  if (!first) throw new Error("Configured company provider inventory was unexpectedly empty.");
  const verifiedPrincipalIds = new Set(
    input.providerSnapshots.flatMap(({ identity }) =>
      identity.requiredProviderLinks.filter((link) => link.verified).map((link) => link.principalId),
    ),
  );
  const missingPrincipals = first.principals.filter((principal) => !verifiedPrincipalIds.has(principal.id));
  const issues: SsoCompanyProviderReadinessIssue[] = missingPrincipals.map((principal) => ({
    reason: "principal_not_connected",
    message: `${principal.email} has no verified connection to a configured company sign-in provider.`,
    blocking: true,
    workspaceId: null,
    principalId: principal.id,
  }));
  issues.push(...companyWorkspaceReadinessIssues(input.workspaces, verifiedPrincipalIds));
  return { ready: issues.length === 0, issues };
}

function companyWorkspaceReadinessIssues(
  workspaces: readonly SsoCutoverWorkspaceFact[],
  verifiedPrincipalIds: ReadonlySet<string>,
): SsoCompanyProviderReadinessIssue[] {
  const issues: SsoCompanyProviderReadinessIssue[] = [];
  for (const workspace of workspaces) {
    if (workspace.members.length === 0) {
      issues.push({
        reason: "workspace_has_no_members",
        message: `${workspace.workspaceName} (${workspace.workspaceId}) has no active members.`,
        blocking: true,
        workspaceId: workspace.workspaceId,
        principalId: null,
      });
    }
    if (!workspace.members.some((member) => member.role === "owner")) {
      issues.push({
        reason: "workspace_has_no_owner",
        message: `${workspace.workspaceName} (${workspace.workspaceId}) has no active Owner.`,
        blocking: true,
        workspaceId: workspace.workspaceId,
        principalId: null,
      });
    }
    for (const member of workspace.members) {
      if (verifiedPrincipalIds.has(member.principalId)) continue;
      issues.push({
        reason: "workspace_member_not_connected",
        message: `Member ${member.principalId} in ${workspace.workspaceName} (${workspace.workspaceId}) has no verified connection to a configured company sign-in provider.`,
        blocking: true,
        workspaceId: workspace.workspaceId,
        principalId: member.principalId,
      });
    }
  }
  return issues;
}

/** Startup error carrying the same stable findings exposed by operator preflight. */
export class CompanyProviderCutoverReadinessError extends Error {
  constructor(readiness: SsoCompanyProviderReadiness) {
    super(readiness.issues.map(({ message }) => message).join(" "));
    this.name = "CompanyProviderCutoverReadinessError";
    this.issues = readiness.issues;
  }

  readonly issues: readonly SsoCompanyProviderReadinessIssue[];
}

/** Refuse startup when the authoritative multi-provider cutover readiness check finds blockers. */
export function assertCompanyProviderCutoverReady(input: {
  providerIds: ReadonlySet<string>;
  identity: SsoCutoverIdentityPort;
  administration: SsoCutoverAccountAdminPort;
}): void {
  const readiness = input.identity.readSsoCutoverSnapshot(() => {
    const providerSnapshots = [...input.providerIds].map((providerId) => ({
      providerId,
      identity: input.identity.inspectSsoCutover(providerId),
    }));
    return evaluateCompanyProviderCutoverReadiness({
      providerIds: input.providerIds,
      providerSnapshots,
      workspaces: input.administration.inspectSsoCutoverWorkspaces(),
    });
  });
  if (readiness.ready) return;
  throw new CompanyProviderCutoverReadinessError(readiness);
}
