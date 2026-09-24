import { assertAuditOutboxCurrent } from "./auditOutbox";
import { assertAccountControlPlaneCurrent } from "./accounts/sqliteAccountAdminPort";
import {
  evaluateCompanyProviderCutoverReadiness,
  type SsoCompanyProviderReadinessIssue,
} from "./accounts/companyProviderReadiness";
import { evaluateSsoCutoverReadiness } from "./accounts/ssoCutover";
import { assertFederatedIdentitySchemaCurrent } from "./auth";
import { mixedModeCutoverContext } from "./cutoverContext";
import { planDatabaseMigrations, type Db } from "./db";

type SsoCutoverPreflightIssue =
  | SsoCompanyProviderReadinessIssue
  | {
      reason: "open_signup_enabled";
      message: string;
      blocking: true;
      workspaceId: null;
      principalId: null;
    };

/** Inspect the guarded company-provider cutover without mutating the operator's database. */
export async function inspectSsoCutoverPreflight(db: Db, environment: Record<string, string | undefined>) {
  const migrationPlan = planDatabaseMigrations(db);
  if (migrationPlan.migrations.length > 0) {
    throw new Error(
      `Database schema v${migrationPlan.fromVersion} is not current (expected v${migrationPlan.toVersion}); start this release normally before preflight.`,
    );
  }
  const context = await mixedModeCutoverContext(db, environment);
  assertAccountControlPlaneCurrent(db);
  assertAuditOutboxCurrent(db);
  assertFederatedIdentitySchemaCurrent(db);
  const providers = context.auth.providers.filter((provider) => !provider.experimental);
  const providerIds = new Set(providers.map((provider) => provider.id));
  const openSignup = context.resolvedEnvironment.env.SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP === "1";
  const inspection = context.identity.readSsoCutoverSnapshot(() => {
    const providerSnapshots = providers.map((provider) => ({
      providerId: provider.id,
      provider,
      identity: context.identity.inspectSsoCutover(provider.id),
    }));
    const workspaces = providers.length > 0 ? context.administration.inspectSsoCutoverWorkspaces() : [];
    const readiness = evaluateCompanyProviderCutoverReadiness({ providerIds, providerSnapshots, workspaces });
    const diagnostics = providerSnapshots.map(({ provider, identity }) =>
      evaluateSsoCutoverReadiness({
        provider,
        providers: context.auth.providers,
        identity,
        workspaces,
        openSignup,
      }),
    );
    return { readiness, diagnostics };
  });
  const issues: SsoCutoverPreflightIssue[] = [...inspection.readiness.issues];
  if (openSignup) {
    issues.push({
      reason: "open_signup_enabled",
      message: "Open password signup must be disabled before SSO-only mode.",
      blocking: true,
      workspaceId: null,
      principalId: null,
    });
  }
  return {
    ready: inspection.readiness.ready && !openSignup,
    providers,
    issues,
    diagnostics: inspection.diagnostics,
  };
}
