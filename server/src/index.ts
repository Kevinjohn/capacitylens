import { assertSupportedNodeVersion } from "../scripts/check-node.mjs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import { restrictIdentifiedDatabasePermissions } from "./db/filePermissions";
import { DEFAULT_CORS, parseRateLimit } from "./app";
import { initializeOpenDb, openDbConnection, planDatabaseMigrations, seedIfUninitialized } from "./db";
import type { Db } from "./db";
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
import { canTrustProxyHeaders } from "./proxyTrust";
import { createBetterAuthIdentityPort } from "./accounts/betterAuthIdentityPort";
import { createSqliteAccountAdminPort } from "./accounts/sqliteAccountAdminPort";
import { KeyedOperationLock } from "./accounts/KeyedOperationLock";
import { assertCompanyProviderCutoverReady } from "./accounts/companyProviderReadiness";
import {
  createJoiningProviderCallbacks,
  currentJoiningProviderFacts,
} from "./accounts/adminPort/joiningProviderCallbacks";

import { refuseToStart, tryOrRefuse, closeDbSafely, parsePort } from "./boot/refusals";
import { startServerRuntime } from "./boot/serverRuntime";
import { applyProductionDefaults, resolveHttps } from "./boot/productionDefaults";
import { runInitCli } from "./cli/init";

export { parseAuditMaxMb } from "./boot/refusals";

const ACCOUNT_APPLICATION: BoundApplication = DEFAULT_ACCOUNT_APPLICATION;
function resolveOptionalEnvironmentValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value;
}

// The built web app served beside the API. Explicitly empty disables it; an explicit directory must
// hold index.html, because a mistyped path must refuse rather than quietly run API-only. Unset: serve
// the release archive's own dist/ (server/dist/index.mjs -> ../../dist) only when the packager's
// marker proves this is a generated release, so a source checkout never serves a stale local build.
function resolveWebDir(configured: string | undefined): string | undefined {
  if (configured === "") return undefined;
  if (configured !== undefined) {
    const directory = resolve(configured);
    if (!existsSync(join(directory, "index.html"))) {
      throw new Error(
        `CAPACITYLENS_WEB_DIR=${configured} has no index.html. Point it at the built web app or unset it.`,
      );
    }
    return directory;
  }
  const releaseRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const bundledWebDir = join(releaseRoot, "dist");
  const isGeneratedRelease = existsSync(join(releaseRoot, ".capacitylens-generated-release"));
  return isGeneratedRelease && existsSync(join(bundledWebDir, "index.html")) ? bundledWebDir : undefined;
}

assertSupportedNodeVersion();

// Secrets, SQLite/WAL files, audit logs, and backups created by this process must never inherit a
// permissive shell/container umask. Individual writers also pin 0600 for defence in depth.
process.umask(0o077);

// `init` writes the environment file the rest of this entrypoint reads, so it runs before the reset
// interlock, account resolution or any database open, and needs none of them to be configured.
if (process.argv[2] === "init") {
  process.exit(await runInitCli(process.argv.slice(3)));
}

// Environment variables: docs-src/self-hosting/configuration.md.

// Safety interlock before anything opens: the test-only reset route must be impossible
// in production (see bootGuard.ts).
if (isResetForbidden(process.env)) {
  console.error(
    "capacitylens-server: refusing to start — CAPACITYLENS_ALLOW_RESET=1 with NODE_ENV=production would expose the destructive test-only reset route. Unset one of them.",
  );
  process.exit(1);
}

// Production defaults must land before any parser or the posture guard reads the environment.
applyProductionDefaults(process.env);
const accountResolution = tryOrRefuse(() => resolveAccountEnvironment(process.env));
const accountEnv: Record<string, string | undefined> = accountResolution.env;

const dbPath = process.env.CAPACITYLENS_DB ?? "capacitylens.db";
const port = parsePort(process.env.PORT);
// Bind localhost-only by default so a dev/laptop run isn't reachable from the LAN; set
// CAPACITYLENS_HOST=0.0.0.0 to deliberately expose it (container/LAN/deploy).
const host = process.env.CAPACITYLENS_HOST ?? "127.0.0.1";
const allowReset = process.env.CAPACITYLENS_ALLOW_RESET === "1";
const corsOrigin = process.env.CAPACITYLENS_CORS_ORIGIN ?? DEFAULT_CORS;
// Single-company cap (see AppOptions.multiAccount), off by default, so a fresh real deploy starts
// capped to the first company it creates until the operator deliberately opts in to more.
const multiAccount = process.env.CAPACITYLENS_MULTI_ACCOUNT === "1";
// HSTS only, emitted when CAPACITYLENS_HTTPS=1, or (unless "0") when the public URL is https,
// since HSTS over plain HTTP is harmful. The other helmet baseline headers are on regardless.
const https = resolveHttps(accountEnv);
const log = process.env.CAPACITYLENS_LOG === "1";
const healthDeep = process.env.CAPACITYLENS_HEALTH_DEEP === "1";
const rateLimit = parseRateLimit(process.env.CAPACITYLENS_RATE_LIMIT);
const webDir = tryOrRefuse(() => resolveWebDir(process.env.CAPACITYLENS_WEB_DIR));
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
  // Harden only after identity/history validation, before any sensitive rollback snapshot.
  restrictIdentifiedDatabasePermissions(db);
  // Resolve every auth/provider option while the database is still at its original version.
  // Auth-control verification and lease maintenance are deferred until app migration succeeds.
  const joiningProviderCallbacks =
    accountEnv.CAPACITYLENS_SECRET &&
    accountEnv.CAPACITYLENS_PUBLIC_URL &&
    URL.canParse(accountEnv.CAPACITYLENS_PUBLIC_URL)
      ? createJoiningProviderCallbacks({
          db,
          applicationId: ACCOUNT_APPLICATION.applicationId,
          secret: accountEnv.CAPACITYLENS_SECRET,
          secureCookies: new URL(accountEnv.CAPACITYLENS_PUBLIC_URL).protocol === "https:",
        })
      : null;
  ({ mode: authMode, auth } = createAuthFromEnvironment(db, accountEnv, {
    trustedOrigins: corsOrigin
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    deferDatabaseSetup: true,
    application: ACCOUNT_APPLICATION,
    ...(joiningProviderCallbacks ? { joiningProviderCallbacks } : {}),
    externalIdentityAdmission: (candidate) =>
      canAdmitLocalExternalIdentity({
        bootstrapEmails: accountEnv.CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS,
        candidate,
        identityHasAnyPrincipal: () => countUsers(db) !== 0,
        hasLivePreauthorizedInvitation: (email) => hasLivePreauthorizedInvitation(db, email),
      }) ||
      joiningProviderCallbacks?.admitsNewIdentity({
        ...candidate,
        facts: currentJoiningProviderFacts(candidate.providerId),
        hasAnyPrincipal: countUsers(db) !== 0,
      }) === true,
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
    ensureAuthControlTables(db);
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
  if (auth && authMode === "sso-only") {
    const companyProviders = auth.permittedCompanyProviderIds ?? new Set<string>();
    if (companyProviders.size === 0)
      throw new AuthConfigError("Provider-required mode has no configured company provider.");
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
    });
    // Reconfirm readiness under the same writer reservation that seals the boundary. This prevents
    // another server process from admitting a blocker between preflight and the cutover mutation.
    await identity.revokeAllForSsoCutover(() => {
      assertCompanyProviderCutoverReady({ providerIds: companyProviders, identity, administration });
    });
  }
  // First-run owner bootstrap, after the auth tables exist, before the app serves a request. In
  // off/sso mode createBootstrapAdmin throws AuthConfigError (the flag is meaningless there),
  // which this catch frames as a legible refusal; with users already present it logs one
  // "skipped" line and boot continues (deliberately not an error, see its TSDoc).
  if (bootstrapAdmin) await createBootstrapAdmin(db, authMode, auth);
  if (process.env.CAPACITYLENS_SEED_DEMO === "1") seedIfUninitialized(db, seedForCurrentWeek());
  stopStartupIfRequested({ startupSignals, openDb: db });
  userCount = countUsers(db);
  if (
    allowsPasswordSignIn(authMode) &&
    userCount === 0 &&
    accountEnv.CAPACITYLENS_ALLOW_OPEN_SIGNUP !== "1" &&
    !accountEnv.CAPACITYLENS_SETUP_TOKEN
  ) {
    throw new AuthConfigError(
      "A fresh password instance requires CAPACITYLENS_SETUP_TOKEN (or an explicit bootstrap-admin/open-signup override).",
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
startServerRuntime({
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
    multiAccount,
    https,
    log,
    healthDeep,
    rateLimit,
    trustProxyHeaders,
    ...(bootstrapToken === undefined ? {} : { bootstrapToken }),
    authMode,
    auth,
    ...(authMode === "off" || !accountEnv.CAPACITYLENS_SECRET || !accountEnv.CAPACITYLENS_PUBLIC_URL
      ? {}
      : {
          joiningProof: {
            secret: accountEnv.CAPACITYLENS_SECRET,
            publicUrl: new URL(accountEnv.CAPACITYLENS_PUBLIC_URL),
          },
        }),
    allowOpenSignup: accountEnv.CAPACITYLENS_ALLOW_OPEN_SIGNUP === "1",
    ...(webDir === undefined ? {} : { webDir }),
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
