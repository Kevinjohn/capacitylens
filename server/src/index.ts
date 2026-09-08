import { DEFAULT_CORS, parseRateLimit } from "./app";
import { initializeOpenDb, openDbConnection, planDatabaseMigrations, seedIfUninitialized, type Db } from "./db";
import { seedForCurrentWeek } from "@capacitylens/shared/data/seed";
import { installStartupSignalHandlers, stopStartupIfRequested } from "./startupSignals";
import { isResetForbidden } from "./bootGuard";
import { evaluateProductionPosture } from "./productionGuard";
import {
  createAuthFromEnvironment,
  runAuthMigrations,
  createBootstrapAdmin,
  countUsers,
  DEFAULT_ACCOUNT_APPLICATION,
  AuthConfigError,
  ensureAuthControlTables,
  planAuthSchemaMigrations,
} from "./auth";
import { parseBackupConfig, writePreMigrationBackup } from "./backup";
import { loadInternalTls } from "./internalTls";
import { resolveAccountEnvironment } from "./accountConfig";
import type { BoundApplication } from "@capacitylens/shared/account/types";
import { canAdmitLocalExternalIdentity } from "./accounts/externalIdentityAdmission";
import { hasLivePreauthorizedInvitation } from "./accounts/sqliteAccountAdminPort";
import { resolveLegacyProxyTrustWarning, canTrustProxyHeaders } from "./proxyTrust";
import { createBetterAuthIdentityPort } from "./accounts/betterAuthIdentityPort";
import { createSqliteAccountAdminPort } from "./accounts/sqliteAccountAdminPort";
import { KeyedOperationLock } from "./accounts/KeyedOperationLock";
import { formatSsoCutoverRefusal, ssoCutoverReadiness } from "./accounts/ssoCutover";

import { refuseToStart, tryOrRefuse, closeDbSafely, parsePort } from "./boot/refusals";
import { createServerRuntime } from "./boot/serverRuntime";

export { parseAuditMaxMb } from "./boot/refusals";

const ACCOUNT_APPLICATION: BoundApplication = DEFAULT_ACCOUNT_APPLICATION;
function resolveOptionalEnvironmentValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value;
}

// Secrets, SQLite/WAL files, audit logs, and backups created by this process must never inherit a
// permissive shell/container umask. Individual writers also pin 0600 for defence in depth.
process.umask(0o077);

// Environment variables: docs-src/self-hosting/configuration.md.

// Safety interlock before anything opens: the test-only reset route must be impossible
// in production (see bootGuard.ts).
if (isResetForbidden(process.env)) {
  console.error(
    "capacitylens-server: refusing to start — CAPACITYLENS_ALLOW_RESET=1 with NODE_ENV=production would expose the destructive test-only reset route. Unset one of them.",
  );
  process.exit(1);
}

const accountResolution = tryOrRefuse(() => resolveAccountEnvironment(process.env));
const accountEnv: Record<string, string | undefined> = accountResolution.env;
const accountProfile: ReturnType<typeof resolveAccountEnvironment>["profile"] = accountResolution.profile;

const dbPath = process.env.CAPACITYLENS_DB ?? "capacitylens.db";
const port = parsePort(process.env.PORT);
// Bind localhost-only by default so a dev/laptop run isn't reachable from the LAN; set
// CAPACITYLENS_HOST=0.0.0.0 to deliberately expose it (container/LAN/deploy).
const host = process.env.CAPACITYLENS_HOST ?? "127.0.0.1";
const allowReset = process.env.CAPACITYLENS_ALLOW_RESET === "1";
const corsOrigin = process.env.CAPACITYLENS_CORS_ORIGIN ?? DEFAULT_CORS;
const optimisticConcurrency = process.env.CAPACITYLENS_OPTIMISTIC_CONCURRENCY !== "0";
// Single-company cap (see AppOptions.multiAccount) — off by default, so a fresh real deploy starts
// capped to the first company it creates until the operator deliberately opts in to more.
const multiAccount = process.env.CAPACITYLENS_MULTI_ACCOUNT === "1";
// HSTS only — gated OFF by default (HSTS over plain HTTP is harmful; this server usually
// runs HTTP behind a TLS proxy). The other helmet baseline headers are on regardless.
const https = process.env.CAPACITYLENS_HTTPS === "1";
const log = process.env.CAPACITYLENS_LOG === "1";
const healthDeep = process.env.CAPACITYLENS_HEALTH_DEEP === "1";
const rateLimit = parseRateLimit(process.env.CAPACITYLENS_RATE_LIMIT);
const requireMfa = accountEnv.CAPACITYLENS_REQUIRE_MFA === "1";
const internalTls: ReturnType<typeof loadInternalTls> = tryOrRefuse(() =>
  loadInternalTls({ environment: process.env }),
);
// Empty and unset values both disable token-based org creation; an empty secret is never valid.
const bootstrapToken = resolveOptionalEnvironmentValue(process.env.CAPACITYLENS_BOOTSTRAP_TOKEN);
// Normalize the environment switch and one-shot shell flag before posture validation and bootstrap.
const bootstrapAdmin =
  process.env.CAPACITYLENS_CREATE_ADMIN_ADMIN === "1" || process.argv.includes("--create-owner-admin-admin");
// A directly exposed listener trusts no forwarded identity or scheme unless explicitly configured.
const trustProxyHeaders = canTrustProxyHeaders(process.env, host);
const proxyTrustWarning = resolveLegacyProxyTrustWarning(process.env);
if (proxyTrustWarning) console.warn(`capacitylens-server: configuration warning — ${proxyTrustWarning}`);
const backupConfig: ReturnType<typeof parseBackupConfig> = tryOrRefuse(() =>
  parseBackupConfig(process.env, (message) => console.warn(message)),
);

// Validate every pure production posture rule before opening the database. A deployment typo must
// not advance the schema and then fail for a reason that was knowable without touching storage.
const posture: ReturnType<typeof evaluateProductionPosture> = tryOrRefuse(() =>
  evaluateProductionPosture(bootstrapAdmin ? { ...accountEnv, CAPACITYLENS_CREATE_ADMIN_ADMIN: "1" } : accountEnv),
);
for (const w of posture.warnings) {
  console.warn(`capacitylens-server: production posture warning — ${w}`);
}
if (posture.refusals.length > 0) {
  console.error(
    `capacitylens-server: refusing to start — production posture:\n${posture.refusals.map((r) => `  - ${r}`).join("\n")}`,
  );
  process.exit(1);
}

// Signals must be owned before storage bootstrap begins. The lightweight handler only latches the
// request: startup operations reach explicit safe checkpoints before the database is closed. Once
// Fastify and the backup controller exist, these listeners are replaced by the full drain handler.
const startupSignals = installStartupSignalHandlers({
  onRequested: (signal) => {
    console.log(`capacitylens-server: ${signal} during startup — stopping at the next safe checkpoint`);
  },
  onRepeated: () => process.exit(1),
});

// Existing databases take a verified rollback snapshot before the first schema mutation.
let db!: Db;
let authMode!: ReturnType<typeof createAuthFromEnvironment>["mode"];
let auth!: ReturnType<typeof createAuthFromEnvironment>["auth"];
try {
  db = openDbConnection(dbPath);
  const migrationPlan = planDatabaseMigrations(db);
  // Resolve every auth/provider option while the database is still at its original version.
  // Auth-control verification and lease maintenance are deferred until app migration succeeds.
  ({ mode: authMode, auth } = createAuthFromEnvironment(db, accountEnv, {
    trustedOrigins: corsOrigin
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    deferDatabaseSetup: true,
    application: ACCOUNT_APPLICATION,
    externalIdentityAdmission: (candidate) =>
      canAdmitLocalExternalIdentity({
        bootstrapEmails: accountEnv.CAPACITYLENS_SSO_BOOTSTRAP_EMAILS,
        candidate,
        identityHasAnyPrincipal: () => countUsers(db) !== 0,
        hasLivePreauthorizedInvitation: (email) => hasLivePreauthorizedInvitation(db, email),
      }),
  }));
  const authMigrationPlan = auth ? await planAuthSchemaMigrations(auth) : { pending: false, tables: [] };
  const needsMigrationSnapshot = migrationPlan.migrations.length > 0 || authMigrationPlan.pending;
  if (needsMigrationSnapshot && !migrationPlan.fresh) {
    await writePreMigrationBackup({
      db,
      options: {
        dbPath,
        fromVersion: migrationPlan.fromVersion,
        toVersion: migrationPlan.toVersion,
        ...(backupConfig == null ? {} : { dir: backupConfig.dir }),
      },
    });
    stopStartupIfRequested({ startupSignals, openDb: db });
  }
  initializeOpenDb(db, dbPath);
  if (auth) {
    ensureAuthControlTables(db, accountEnv);
    auth.ensureProviderBindings();
  }
  stopStartupIfRequested({ startupSignals, openDb: db });
} catch (e) {
  closeDbSafely(db);
  refuseToStart(e instanceof Error ? e.message : String(e));
}

// Auth migration and opt-in demo seeding are fatal boot preconditions. Seeding still follows the
// persistent initialized marker, so deleting all data never causes an automatic reseed.
// The user count is reused by the setup-lock notice; no intervening step mutates the user table.
let userCount!: number;
try {
  if (auth) {
    await runAuthMigrations(auth);
    auth.reconcileFederatedLinks?.();
    stopStartupIfRequested({ startupSignals, openDb: db });
  }
  if (auth && authMode === "sso" && (accountProfile === "self-hosted-sso-only" || accountProfile === null)) {
    const provider = auth.strictProvider;
    if (!provider) throw new AuthConfigError("The SSO-only cutover has no configured strict OIDC provider.");
    const identity = createBetterAuthIdentityPort({
      applicationId: ACCOUNT_APPLICATION.applicationId,
      auth,
      authMode,
      db,
    });
    const administration = createSqliteAccountAdminPort({
      applicationId: ACCOUNT_APPLICATION.applicationId,
      db,
      lock: new KeyedOperationLock(),
      trustedLocal: false,
      requireMfa: false,
    });
    // Reconfirm readiness under the same writer reservation that seals the boundary. This prevents
    // another server process from admitting a blocker between preflight and the cutover mutation.
    await identity.revokeAllForSsoCutover(() => {
      const readiness = ssoCutoverReadiness({
        provider,
        providers: auth.providers,
        identity,
        administration,
        openSignup: accountEnv.CAPACITYLENS_ALLOW_OPEN_SIGNUP === "1",
      });
      if (!readiness.ready) {
        throw new AuthConfigError(`SSO cutover readiness failed. ${formatSsoCutoverRefusal(readiness)}`);
      }
    });
  }
  // First-run owner bootstrap — AFTER the auth tables exist, BEFORE the app serves a request. In
  // off/sso mode createBootstrapAdmin throws AuthConfigError (the flag is meaningless there),
  // which this catch frames as a legible refusal; with users already present it logs one
  // "skipped" line and boot continues (deliberately NOT an error — see its TSDoc).
  if (bootstrapAdmin) await createBootstrapAdmin(db, authMode, auth);
  if (process.env.CAPACITYLENS_SEED_DEMO === "1") seedIfUninitialized(db, seedForCurrentWeek());
  stopStartupIfRequested({ startupSignals, openDb: db });
  userCount = countUsers(db);
  if (
    authMode === "password" &&
    userCount === 0 &&
    accountEnv.CAPACITYLENS_ALLOW_OPEN_SIGNUP !== "1" &&
    !accountEnv.CAPACITYLENS_SETUP_TOKEN
  ) {
    throw new AuthConfigError(
      "A fresh password instance requires SMALLSASS_ACCOUNT_SETUP_TOKEN (or an explicit bootstrap-admin/open-signup override).",
    );
  }
} catch (e) {
  refuseToStart(e instanceof Error ? e.message : String(e));
}

const securityLog = (event: Record<string, unknown>) => {
  console.log(
    JSON.stringify({
      type: "capacitylens.security",
      ts: new Date().toISOString(),
      ...event,
    }),
  );
};

// Frame the complete post-migration boot phase. These steps are all fatal preconditions, but raw
// top-level stacks are poor operator diagnostics and bypass the entrypoint's refusal convention.
createServerRuntime({
  application: ACCOUNT_APPLICATION,
  applicationOptions: {
    ...(internalTls
      ? {
          internalTls: {
            ...(internalTls.key === undefined ? {} : { key: internalTls.key }),
            ...(internalTls.cert === undefined ? {} : { cert: internalTls.cert }),
            ...(internalTls.minVersion === undefined ? {} : { minVersion: internalTls.minVersion }),
          },
          internalTlsExpiresAt: internalTls.expiresAt,
          internalTlsFingerprintSha256: internalTls.fingerprintSha256,
        }
      : {}),
    allowReset,
    corsOrigin,
    optimisticConcurrency,
    multiAccount,
    https,
    log,
    healthDeep,
    rateLimit,
    trustProxyHeaders,
    ...(bootstrapToken === undefined ? {} : { bootstrapToken }),
    authMode,
    auth,
    requireMfa,
    allowOpenSignup: accountEnv.CAPACITYLENS_ALLOW_OPEN_SIGNUP === "1",
  },
  backupConfig,
  db,
  dbPath,
  environment: process.env,
  host,
  port,
  startupSignals,
  securityLog,
  userCount,
  logEnabled: log,
  logWarning: console.warn,
  exit: (code) => process.exit(code),
  onProcessEvent: process.on.bind(process),
  logInfo: console.log,
  logError: console.error,
});
