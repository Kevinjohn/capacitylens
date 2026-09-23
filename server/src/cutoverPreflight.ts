import { assertAuditOutboxCurrent } from "./auditOutbox";
import { assertAccountControlPlaneCurrent } from "./accounts/sqliteAccountAdminPort";
import { assertCompanyProviderCutoverReady, ssoCutoverReadiness } from "./accounts/ssoCutover";
import { assertFederatedIdentitySchemaCurrent } from "./auth";
import { mixedModeCutoverContext } from "./cutoverContext";
import { planDatabaseMigrations, type Db } from "./db";

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
  let refusal: string | null = null;
  try {
    context.identity.readSsoCutoverSnapshot(() =>
      assertCompanyProviderCutoverReady({
        providerIds,
        identity: context.identity,
        administration: context.administration,
      }),
    );
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Provider-required ")) throw error;
    refusal = error.message;
  }
  const openSignup = context.resolvedEnvironment.env.SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP === "1";
  if (openSignup) refusal = "Open password signup must be disabled before SSO-only mode.";
  // The detailed projection is single-provider. Keep it for installations with one company
  // provider; the authoritative status above accepts a verified link to either named provider.
  const diagnostics =
    providers.length === 1
      ? ssoCutoverReadiness({
          provider: context.provider,
          providers: context.auth.providers,
          identity: context.identity,
          administration: context.administration,
          openSignup,
        })
      : null;
  return {
    ready: refusal === null,
    providers,
    issues: refusal === null ? [] : [{ message: refusal }],
    diagnostics,
  };
}
