import { buildApp, DEFAULT_CORS, parseRateLimit } from "./app";
import { initializeOpenDb, openDbConnection, planDatabaseMigrations, seedIfUninitialized, type Db } from "./db";
import { seedForCurrentWeek } from "@capacitylens/shared/data/seed";
import { createLastResortErrorHandler, createShutdownHandler, handleListenFailure } from "./shutdown";
import { installStartupSignalHandlers } from "./startupSignals";
import { resetForbidden } from "./bootGuard";
import { evaluateProductionPosture } from "./productionGuard";
import {
  authFromEnv,
  runAuthMigrations,
  createBootstrapAdmin,
  countUsers,
  DEFAULT_ACCOUNT_APPLICATION,
  AuthConfigError,
  ensureAuthControlTables,
  planAuthSchemaMigrations,
} from "./auth";
import { parseBackupConfig, startBackups, formatBackupStartupFailure, writePreMigrationBackup } from "./backup";
import { compositeAuditSink, fileAuditSink, noopAuditSink, parseAuditConfig, streamAuditSink } from "./audit";
import { loadInternalTls } from "./internalTls";
import { resolveAccountEnvironment } from "./accountConfig";
import type { BoundApplication } from "@capacitylens/shared/account/types";
import { localExternalIdentityAdmission } from "./accounts/externalIdentityAdmission";
import { hasLivePreauthorizedInvitation } from "./accounts/sqliteAccountAdminPort";
import { legacyProxyTrustWarning, trustProxyHeadersFrom } from "./proxyTrust";
import { betterAuthIdentityPort } from "./accounts/betterAuthIdentityPort";
import { sqliteAccountAdminPort } from "./accounts/sqliteAccountAdminPort";
import { KeyedOperationLock } from "./accounts/operationLock";
import { formatSsoCutoverRefusal, ssoCutoverReadiness } from "./accounts/ssoCutover";

import { refuseToStart, tryOrRefuse, closeDbSafely, parsePort, parseAuditMaxMb } from "./boot/refusals";

export { parseAuditMaxMb } from "./boot/refusals";

const ACCOUNT_APPLICATION: BoundApplication = DEFAULT_ACCOUNT_APPLICATION;

// Secrets, SQLite/WAL files, audit logs, and backups created by this process must never inherit a
// permissive shell/container umask. Individual writers also pin 0600 for defence in depth.
process.umask(0o077);

// Environment variables: docs-src/self-hosting/configuration.md.

// Safety interlock before anything opens: the test-only reset route must be impossible
// in production (see bootGuard.ts).
if (resetForbidden(process.env)) {
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
const internalTls: ReturnType<typeof loadInternalTls> = tryOrRefuse(() => loadInternalTls(process.env));
// P1.8 constrained org-creation. An empty/unset value leaves the token path DISABLED (the app
// treats undefined and '' identically — bootstrapTokenMatches never allows an empty secret), so
// the secure default holds: POST /api/orgs is first-run-only or an existing Owner/Admin.
const bootstrapToken = process.env.CAPACITYLENS_BOOTSTRAP_TOKEN || undefined;
// First-run owner bootstrap: one switch, two spellings — the env var is the repo convention, the
// argv flag exists for one-shot shells (`node ... --create-owner-admin-admin`) where exporting an
// env var is awkward. Normalized ONCE here; everything downstream (the production refusal,
// createBootstrapAdmin) sees a single boolean.
const bootstrapAdmin =
  process.env.CAPACITYLENS_CREATE_ADMIN_ADMIN === "1" || process.argv.includes("--create-owner-admin-admin");
// Forwarded client identity and public-origin scheme are one trusted-proxy deployment fact. On a
// loopback listener only the local proxy can reach the API; a directly exposed listener trusts
// neither client-spoofable header unless the operator explicitly opts in.
const trustProxyHeaders = trustProxyHeadersFrom(process.env, host);
const proxyTrustWarning = legacyProxyTrustWarning(process.env);
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

const stopStartupIfRequested = (openDb?: Db) => {
  const signal = startupSignals.requested();
  if (!signal) return;
  try {
    openDb?.close();
  } catch (error) {
    console.error("capacitylens-server: database close failed while stopping startup", error);
  }
  startupSignals.dispose();
  process.exit(0);
};

// Open without application DDL, inspect the immutable migration plan, and take a verified online
// rollback snapshot before the first schema mutation. Existing databases fail closed when that
// snapshot cannot be written; fresh/in-memory databases have nothing to roll back.
let db!: Db;
let authMode!: ReturnType<typeof authFromEnv>["mode"];
let auth!: ReturnType<typeof authFromEnv>["auth"];
try {
  db = openDbConnection(dbPath);
  const migrationPlan = planDatabaseMigrations(db);
  // Resolve every auth/provider option while the database is still at its original version.
  // Auth-control verification and lease maintenance are deferred until app migration succeeds.
  ({ mode: authMode, auth } = authFromEnv(db, accountEnv, {
    trustedOrigins: corsOrigin
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    deferDatabaseSetup: true,
    application: ACCOUNT_APPLICATION,
    externalIdentityAdmission: (candidate) =>
      localExternalIdentityAdmission({
        bootstrapEmails: accountEnv.CAPACITYLENS_SSO_BOOTSTRAP_EMAILS,
        candidate,
        identityHasAnyPrincipal: () => countUsers(db) !== 0,
        hasLivePreauthorizedInvitation: (email) => hasLivePreauthorizedInvitation(db, email),
      }),
  }));
  const authMigrationPlan = auth ? await planAuthSchemaMigrations(auth) : { pending: false, tables: [] };
  const needsMigrationSnapshot = migrationPlan.migrations.length > 0 || authMigrationPlan.pending;
  if (needsMigrationSnapshot && !migrationPlan.fresh) {
    await writePreMigrationBackup(db, {
      dbPath,
      fromVersion: migrationPlan.fromVersion,
      toVersion: migrationPlan.toVersion,
      dir: backupConfig?.dir,
    });
    stopStartupIfRequested(db);
  }
  initializeOpenDb(db, dbPath);
  if (auth) {
    ensureAuthControlTables(db, accountEnv);
    auth.ensureProviderBindings();
  }
  stopStartupIfRequested(db);
} catch (e) {
  closeDbSafely(db);
  refuseToStart(e instanceof Error ? e.message : String(e));
}

// Create/upgrade the auth tables only when auth is on (an off-mode DB never grows them), then
// OPT-IN seed a never-initialised DB. Both are boot preconditions — a failure must crash legibly,
// not limp on.
//
// Demo seed is OPT-IN (CAPACITYLENS_SEED_DEMO=1), NOT automatic: the seed fixture ships TWO
// companies, which the single-company cap (AppOptions.multiAccount, default off) would otherwise
// immediately contradict on a fresh real deploy — a from-scratch server now starts EMPTY and the
// operator creates their one company as the first-run bootstrap (POST /api/orgs / POST
// /api/accounts, both open while the table is empty). Dev (scripts/dev-fullstack.mjs) sets this
// flag (plus CAPACITYLENS_MULTI_ACCOUNT=1) so its batteries-included two-company fixture is
// unaffected; the auth-e2e harness (server/package.json start:auth-e2e) provisions its orgs live
// via POST /api/orgs instead of this seed, so it only needs CAPACITYLENS_MULTI_ACCOUNT=1.
//
// seedIfUninitialized gates on the persistent `initialized` marker, NOT mere emptiness: a user who
// deletes all their data leaves an empty-but-initialised DB and must NOT get the demo dataset
// re-seeded on the next restart (matches /api/meta's isInitialized() check) — that rule is
// unchanged; this only adds a flag gate in FRONT of it.
// Captured once below and reused by the SETUP LOCKED check further down: nothing between the two
// reads mutates the `user` table (bootstrapAdmin/seed both run BEFORE this first read), so a second
// query would only re-observe the same count.
let userCount!: number;
try {
  if (auth) {
    await runAuthMigrations(auth);
    auth.reconcileFederatedLinks?.();
    stopStartupIfRequested(db);
  }
  if (auth && authMode === "sso" && (accountProfile === "self-hosted-sso-only" || accountProfile === null)) {
    const provider = auth.strictProvider;
    if (!provider) throw new AuthConfigError("The SSO-only cutover has no configured strict OIDC provider.");
    const identity = betterAuthIdentityPort({
      applicationId: ACCOUNT_APPLICATION.applicationId,
      auth,
      authMode,
      db,
    });
    const administration = sqliteAccountAdminPort({
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
  stopStartupIfRequested(db);
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
const { app, backups } = (() => {
  let startingBackups = false;
  try {
    // SETUP LOCKED notice: userCount was captured after the bootstrap block, so a boot that created
    // the explicit admin credential skips this. The boot interlock above guarantees the token exists
    // here.
    if (authMode === "password" && userCount === 0) {
      console.warn(
        "capacitylens-server: SETUP LOCKED — no user accounts exist yet; owner creation requires the " +
          "configured SMALLSASS_ACCOUNT_SETUP_TOKEN.",
      );
    }

    // Audit log (P1.15, flag CAPACITYLENS_AUDIT — ON BY DEFAULT; =off is development-only).
    const auditCfg = parseAuditConfig(process.env, dbPath);
    const auditMaxBytes = parseAuditMaxMb(process.env.CAPACITYLENS_AUDIT_MAX_MB) * 1024 * 1024;
    const auditFileSink = auditCfg.enabled
      ? fileAuditSink(auditCfg.file, (m) => console.error(m), {
          maxBytes: auditMaxBytes,
        })
      : noopAuditSink();
    const auditSink =
      process.env.CAPACITYLENS_AUDIT_STDOUT === "1"
        ? compositeAuditSink(auditFileSink, streamAuditSink(console.log))
        : auditFileSink;

    let backupController: ReturnType<typeof startBackups> | null = null;
    const app = buildApp(db, {
      application: ACCOUNT_APPLICATION,
      internalTls: internalTls
        ? {
            key: internalTls.key,
            cert: internalTls.cert,
            minVersion: internalTls.minVersion,
          }
        : undefined,
      internalTlsExpiresAt: internalTls?.expiresAt,
      internalTlsFingerprintSha256: internalTls?.fingerprintSha256,
      allowReset,
      corsOrigin,
      optimisticConcurrency,
      multiAccount,
      https,
      log,
      healthDeep,
      backupHealth: backupConfig
        ? () =>
            backupController?.health ?? {
              degraded: false,
              lastSuccessAt: null,
            }
        : undefined,
      rateLimit,
      trustProxyHeaders,
      bootstrapToken,
      authMode,
      auth,
      requireMfa,
      allowOpenSignup: accountEnv.CAPACITYLENS_ALLOW_OPEN_SIGNUP === "1",
      audit: auditSink,
      securityLog,
    });

    // Backups (P4.1, flag CAPACITYLENS_BACKUP_DIR — default OFF: no timer, no writes).
    if (backupConfig) {
      startingBackups = true;
      backupController = startBackups(db, backupConfig, log ? (m) => app.log.info(m) : console.log);
      startingBackups = false;
    }
    return { app, backups: backupController };
  } catch (error) {
    closeDbSafely(db);
    startupSignals.dispose();
    refuseToStart(
      startingBackups && backupConfig
        ? formatBackupStartupFailure(backupConfig.dir, error)
        : error instanceof Error
          ? error.message
          : String(error),
    );
  }
})();

// Graceful shutdown (P1.2): the deploy restarts the daemon with a signal — drain in-flight
// requests, then close the DB, instead of dying mid-transaction. A repeat signal force-exits.
// Backup stop and Fastify close begin together: the timer is cleared, new snapshots are refused,
// and the listener stops accepting work immediately. SQLite closes only after both any in-flight
// snapshot and every accepted request have drained (P4.1; a SIGTERM during the start-up shot would
// otherwise truncate a snapshot mid-write).
const shutdown = createShutdownHandler(
  app,
  db,
  (code) => process.exit(code),
  backups ? () => backups.stop() : undefined,
);
const onSignal = (sig: NodeJS.Signals) => {
  console.log(`capacitylens-server: ${sig} — draining requests, then exiting`);
  void shutdown(0, `signal:${sig}`);
};
// No event-loop turn occurs between removing the startup listeners and installing these handlers,
// so a queued signal is observed by one phase or the other, never by neither.
startupSignals.dispose();
process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("SIGINT", () => onSignal("SIGINT"));

const lastResort = createLastResortErrorHandler(shutdown, securityLog, (message, error) =>
  console.error(message, error),
);
process.on("uncaughtException", (error) => {
  void lastResort("uncaught_exception", error);
});
process.on("unhandledRejection", (reason) => {
  void lastResort("unhandled_rejection", reason);
});

app
  .listen({ port, host })
  .then((addr) => console.log(`capacitylens-server listening on ${addr} (db=${dbPath}, reset=${allowReset})`))
  .catch((err) => {
    void handleListenFailure(err, shutdown);
  });
