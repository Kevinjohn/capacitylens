import { assertAuditOutboxCurrent } from "./auditOutbox";
import { assertAccountControlPlaneCurrent } from "./accounts/sqliteAccountAdminPort";
import { ssoCutoverReadiness } from "./accounts/ssoCutover";
import { assertFederatedIdentitySchemaCurrent } from "./auth";
import { mixedModeCutoverContext } from "./cutoverContext";
import { planDatabaseMigrations, type Db } from "./db";

/** Reproduce every SSO-only startup prerequisite without mutating the operator's database. */
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
  return ssoCutoverReadiness({
    provider: context.provider,
    providers: context.auth.providers,
    identity: context.identity,
    administration: context.administration,
    openSignup: context.resolvedEnvironment.env.CAPACITYLENS_ALLOW_OPEN_SIGNUP === "1",
  });
}
