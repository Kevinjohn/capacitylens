import type { FastifyInstance } from "fastify";
import { type SsoCutoverIdentityPort } from "../accounts/betterAuthIdentityPort";
import { registerSsoCutoverRoutes } from "../accounts/ssoCutoverRoutes";
import { registerAccountRoutes } from "../accounts/accountRoutes";
import { memberSignInTrackingSnapshot, setMemberSignInTracking } from "../accounts/memberSignInTracking";
import { registerLifecycleRoutes } from "./lifecycleRoutes";
import { registerAuthProxyRoutes } from "./authProxyRoutes";
import { registerBatchRoutes } from "./batchRoutes";
import { registerEntityRoutes } from "./entityRoutes";
import { registerImportRoutes } from "./importRoutes";
import { registerStateRoutes } from "./stateRoutes";
import { registerSystemRoutes } from "./systemRoutes";
import { isStaleWrite, ownsRow } from "./routeShared";
import { registerMasqueradeRoutes } from "./masqueradeRoutes";
import { registerAccountEntityRoutes } from "./accountEntityRoutes";
import { type Db, isInitialized } from "../db";
import { enqueueAudit } from "../auditOutbox";
import {
  toWebHeaders,
  sessionUserFromApplicationSession,
  sessionSatisfiesRequiredMfa,
  replayAccountCommand,
  accountCommand,
} from "./appRequestAdapters";
import type { resolveAppConfig } from "./appConfig";
import type { createAppRuntime } from "./appRuntime";
import type { installRootHooks } from "./appRootHooks";
import type { installSessionResolution } from "./appSessionResolution";
import type { createAuthorization } from "./appAuthorization";
import type { AppOptions } from "../app";

export function registerApiRoutes(
  app: FastifyInstance,
  db: Db,
  runtime: ReturnType<typeof createAppRuntime>,
  config: ReturnType<typeof resolveAppConfig>,
  opts: AppOptions,
  rootHelpers: ReturnType<typeof installRootHooks>,
  sessionResolution: ReturnType<typeof installSessionResolution>,
  authorization: ReturnType<typeof createAuthorization>,
): void {
  const {
    accountAdminPort,
    accountAudit,
    accountFlows,
    audit,
    auditDrainer,
    commitProductAudit,
    drainProductAudit,
    healthStmt,
    identityPort,
    masquerades,
    store,
  } = runtime;
  const { application, auditSink, auth, authMode, executeImportWorker, logOn } = config;
  const { accountFail, securityEvent, sendFail } = rootHelpers;
  const { resolveIncomingSession } = sessionResolution;
  const {
    authorize,
    authorizeAllowed,
    fieldVisibilityFor,
    memberReadProjection,
    redactWriteEcho,
    resolveEffectiveRole,
  } = authorization;
  // Every route below registers through a child plugin, NOT directly on the root:
  // @fastify/rate-limit attaches to routes via an onRoute hook that only exists once the
  // plugin LOADS (at ready(), in registration order) — a route declared straight on the
  // root would register first and silently escape the limiter. The child loads after it,
  // so its routes are seen, and it inherits the root CORS hook + error handler. The
  // callback shadows `app` deliberately: the route code is identical without the wrapper.
  void app.register(async (app) => {
    const systemRouteDependencies = {
      securityEvent,
      healthStatement: healthStmt,
      auditDrainer,
      auditSink,
      backupHealth: opts.backupHealth,
      internalTlsExpiresAt: opts.internalTlsExpiresAt,
      internalTlsFingerprintSha256: opts.internalTlsFingerprintSha256,
      isInitialized: () => isInitialized(db),
    };
    const authProxyRouteDependencies = {
      authMode,
      auth,
      db,
      multiAccount: opts.multiAccount === true,
      requireMfa: opts.requireMfa === true,
      accountAdminPort,
      masquerades,
      resolveIncomingSession,
      sessionUserFromApplicationSession,
      sessionSatisfiesRequiredMfa,
      toWebHeaders,
      logOn,
    };
    const stateRouteDependencies = {
      db,
      store,
      authMode,
      auth,
      multiAccount: opts.multiAccount === true,
      bootstrapToken: opts.bootstrapToken,
      accountAdminPort,
      accountFlows,
      masquerades,
      authorize,
      resolveEffectiveRole,
      accountCommand,
      accountFail,
      sendFail,
      drainProductAudit,
    };

    registerSystemRoutes(app, { ...systemRouteDependencies, section: "public" });

    registerAuthProxyRoutes(app, { ...authProxyRouteDependencies, section: "identity" });

    // Better Auth's own endpoints (sign-up/sign-in/sign-out/session/OAuth callbacks),
    // mounted ONLY when auth is on — in 'off' mode this route does not exist (the OFF
    // guarantee: zero new attack surface). The static /api/auth/me above outranks this
    // wildcard in Fastify's router. Translation layer: Fastify req → web Request,
    // web Response → Fastify reply (set-cookie kept as separate headers; content-length
    // recomputed by Fastify).
    if (authMode !== "off" && auth) {
      registerSsoCutoverRoutes(app, {
        auth,
        authMode,
        identity: identityPort as SsoCutoverIdentityPort,
        administration: accountAdminPort,
        applicationId: application.applicationId,
        openSignup: opts.allowOpenSignup === true,
        authorize: authorizeAllowed,
        fail: accountFail,
        toWebHeaders,
      });
      registerAuthProxyRoutes(app, { ...authProxyRouteDependencies, section: "proxy" });
    }

    registerStateRoutes(app, { ...stateRouteDependencies, section: "read" });

    registerSystemRoutes(app, { ...systemRouteDependencies, section: "meta" });

    registerStateRoutes(app, { ...stateRouteDependencies, section: "org" });

    registerAccountRoutes(app, {
      authMode,
      authenticationConfigured: auth !== null,
      requiredSsoProviderId: authMode === "sso" ? (auth?.strictProvider?.id ?? null) : null,
      administration: accountAdminPort,
      identity: identityPort,
      flows: accountFlows,
      memberSignInTracking: {
        snapshot: (workspaceId) => memberSignInTrackingSnapshot(db, workspaceId),
        set: (workspaceId, actorPrincipalId, enabled) =>
          setMemberSignInTracking(db, workspaceId, actorPrincipalId, enabled),
      },
      authorize: authorizeAllowed,
      command: accountCommand,
      audit,
      fail: accountFail,
      memberReadProjection,
    });

    registerMasqueradeRoutes(app, {
      authMode,
      applicationId: application.applicationId,
      accountAudit,
      registry: masquerades,
      identity: identityPort,
      authorize: authorizeAllowed,
      roleForPrincipal: (principalId, accountId) =>
        accountAdminPort.roleForPrincipalInWorkspace(principalId, accountId),
      effectiveRole: resolveEffectiveRole,
    });

    registerLifecycleRoutes(app, {
      store,
      authorize: authorizeAllowed,
      commit: (reply, record, mutation) => {
        commitProductAudit(reply, record, mutation);
      },
      fail: sendFail,
      redact: (req, entity, row, accountId) => redactWriteEcho(entity, row, fieldVisibilityFor(req, entity, accountId)),
    });

    // The `accounts` row write surface. These are STATIC paths, which find-my-way matches ahead of
    // the parametric /api/:entity routes below — so an account write can never reach the generic
    // handlers and pick up SCOPED-entity semantics (isScopedTable/ownsRow are both no-ops for a
    // table with no accountId column). Registering them here also deletes the ~25 hand-replicated
    // `entity === "accounts"` branches the generic routes carried, one per verb per rule.
    registerAccountEntityRoutes(app, {
      db,
      store,
      authMode,
      multiAccount: opts.multiAccount === true,
      optimisticConcurrency: opts.optimisticConcurrency !== false,
      flows: accountFlows,
      authorize: authorizeAllowed,
      command: accountCommand,
      replayCommand: replayAccountCommand,
      fieldVisibility: fieldVisibilityFor,
      redact: redactWriteEcho,
      commitProductAudit,
      drainProductAudit,
      ownsRow,
      isStaleWrite,
      enqueueAudit: (record) => enqueueAudit(db, record),
      fail: sendFail,
      accountFail,
    });

    registerEntityRoutes(app, {
      db,
      store,
      authMode,
      optimisticConcurrency: opts.optimisticConcurrency !== false,
      authorize: authorizeAllowed,
      fieldVisibility: fieldVisibilityFor,
      redact: redactWriteEcho,
      commitProductAudit,
      fail: sendFail,
    });

    registerBatchRoutes(app, {
      db,
      store,
      authMode,
      multiAccount: opts.multiAccount === true,
      optimisticConcurrency: opts.optimisticConcurrency !== false,
      accountFlows,
      authorize: authorizeAllowed,
      fieldVisibility: fieldVisibilityFor,
      redact: redactWriteEcho,
      drainProductAudit,
      fail: sendFail,
      accountFail,
    });

    registerImportRoutes(app, {
      db,
      store,
      authMode,
      allowReset: opts.allowReset === true,
      accountAdminPort,
      authorize: authorizeAllowed,
      executeImportWorker,
      commitProductAudit,
      fail: sendFail,
    });
  });
}
