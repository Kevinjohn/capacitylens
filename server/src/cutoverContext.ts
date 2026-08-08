import type { Db } from "./db";
import { resolveAccountEnvironment } from "./accountConfig";
import { authFromEnv, DEFAULT_ACCOUNT_APPLICATION, planAuthSchemaMigrations } from "./auth";
import { betterAuthIdentityPort } from "./accounts/betterAuthIdentityPort";
import { sqliteAccountAdminPort } from "./accounts/sqliteAccountAdminPort";
import { KeyedOperationLock } from "./accounts/operationLock";

/** Construct the shared, non-mutating mixed-mode context used by stopped-server cutover tools. */
export async function mixedModeCutoverContext(db: Db, environment: Record<string, string | undefined>) {
  const resolved = resolveAccountEnvironment(environment);
  if (resolved.profile !== "self-hosted-mixed") {
    throw new Error(
      "SSO cutover tooling requires SMALLSASS_ACCOUNT_DEPLOYMENT_PROFILE=self-hosted-mixed so password recovery remains available while blockers are repaired.",
    );
  }
  const configured = authFromEnv(db, resolved.env, {
    deferDatabaseSetup: true,
    application: DEFAULT_ACCOUNT_APPLICATION,
  });
  if (!configured.auth || configured.mode !== "password" || !configured.auth.strictProvider) {
    throw new Error("The mixed profile did not resolve a strict OIDC provider.");
  }
  const authPlan = await planAuthSchemaMigrations(configured.auth);
  if (authPlan.pending) throw new Error(`Better Auth schema is not current: ${authPlan.tables.join(", ")}.`);
  if (!configured.auth.assertProviderBindings) {
    throw new Error("The auth adapter cannot verify persisted provider bindings.");
  }
  configured.auth.assertProviderBindings();
  return {
    resolvedEnvironment: resolved,
    auth: configured.auth,
    provider: configured.auth.strictProvider,
    identity: betterAuthIdentityPort({
      applicationId: DEFAULT_ACCOUNT_APPLICATION.applicationId,
      auth: configured.auth,
      authMode: configured.mode,
      db,
    }),
    administration: sqliteAccountAdminPort({
      applicationId: DEFAULT_ACCOUNT_APPLICATION.applicationId,
      db,
      lock: new KeyedOperationLock(),
    }),
  };
}
