import type { LifecycleRedactionInput } from "./lifecycleRoutes";
import type { FastifyInstance } from "fastify";
import { type SsoCutoverIdentityPort } from "../accounts/betterAuthIdentityPort";
import { registerSsoCutoverRoutes } from "../accounts/ssoCutoverRoutes";
import { registerAccountRoutes } from "../accounts/accountRoutes";
import { readMemberSignInTrackingSnapshot, setMemberSignInTracking } from "../accounts/memberSignInTracking";
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
  buildSessionUser,
  hasRequiredSessionMfa,
  parseReplayAccountCommand,
  createAccountCommand,
} from "./appRequestAdapters";
import type { resolveAppConfig } from "./appConfig";
import type { createAppRuntime } from "./appRuntime";
import type { installRootHooks } from "./appRootHooks";
import type { installSessionResolution } from "./appSessionResolution";
import type { createAuthorization } from "./appAuthorization";
import type { AppOptions } from "../app";

interface RegisterApiRoutesInput {
  app: FastifyInstance;
  db: Db;
  runtime: ReturnType<typeof createAppRuntime>;
  config: ReturnType<typeof resolveAppConfig>;
  options: AppOptions;
  rootHelpers: ReturnType<typeof installRootHooks>;
  sessionResolution: ReturnType<typeof installSessionResolution>;
  authorization: ReturnType<typeof createAuthorization>;
}

interface RegisterRouteGroupInput extends RegisterApiRoutesInput {
  childApp: FastifyInstance;
}

function registerImportRouteGroup(input: RegisterRouteGroupInput): void {
  const { childApp: app, db, runtime, config, options, rootHelpers, authorization } = input;
  registerImportRoutes(app, {
    db,
    store: runtime.store,
    authMode: config.authMode,
    allowReset: options.allowReset === true,
    accountAdminPort: runtime.accountAdminPort,
    authorize: authorization.authorizeAllowed,
    executeImportWorker: config.executeImportWorker,
    commitProductAudit: runtime.commitProductAudit,
    fail: rootHelpers.sendFail,
  });
}

function registerDataRoutes(input: RegisterRouteGroupInput): void {
  const { childApp: app, db, runtime, config, options, rootHelpers, authorization } = input;
  const { accountFlows, commitProductAudit, drainProductAudit, store } = runtime;
  const { authMode } = config;
  const { accountFail, sendFail } = rootHelpers;
  const { authorizeAllowed, fieldVisibilityFor, redactWriteEcho } = authorization;
  registerAccountEntityRoutes(app, {
    db,
    store,
    authMode,
    multiAccount: options.multiAccount === true,
    optimisticConcurrency: options.optimisticConcurrency !== false,
    flows: accountFlows,
    authorize: authorizeAllowed,
    command: createAccountCommand,
    replayCommand: parseReplayAccountCommand,
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
    optimisticConcurrency: options.optimisticConcurrency !== false,
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
    multiAccount: options.multiAccount === true,
    optimisticConcurrency: options.optimisticConcurrency !== false,
    accountFlows,
    authorize: authorizeAllowed,
    fieldVisibility: fieldVisibilityFor,
    redact: redactWriteEcho,
    drainProductAudit,
    fail: sendFail,
    accountFail,
  });
  registerImportRouteGroup(input);
}

function registerAccountControlRoutes(input: RegisterRouteGroupInput): void {
  const { childApp: app, db, runtime, config, rootHelpers, authorization } = input;
  const { accountAdminPort, accountAudit, accountFlows, audit, identityPort, masquerades, store, commitProductAudit } =
    runtime;
  const { application, auth, authMode } = config;
  const { accountFail, sendFail } = rootHelpers;
  const { authorizeAllowed, fieldVisibilityFor, memberReadProjection, redactWriteEcho, resolveEffectiveRole } =
    authorization;
  registerAccountRoutes(app, {
    authMode,
    authenticationConfigured: auth !== null,
    requiredSsoProviderId: authMode === "sso" ? (auth?.strictProvider?.id ?? null) : null,
    administration: accountAdminPort,
    identity: identityPort,
    flows: accountFlows,
    memberSignInTracking: {
      snapshot: (workspaceId) => readMemberSignInTrackingSnapshot(db, workspaceId),
      set: ({ workspaceId, actorPrincipalId, enabled }) =>
        setMemberSignInTracking({ db, accountId: workspaceId, actorPrincipalId, enabled }),
    },
    authorize: authorizeAllowed,
    command: createAccountCommand,
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
    roleForPrincipal: (principalId, accountId) => accountAdminPort.roleForPrincipalInWorkspace(principalId, accountId),
    effectiveRole: resolveEffectiveRole,
  });
  registerLifecycleRoutes(app, {
    store,
    authorize: authorizeAllowed,
    commit: (reply, record, mutation) => {
      commitProductAudit(reply, record, mutation);
    },
    fail: sendFail,
    redact: ({ req, entity, row, accountId }: LifecycleRedactionInput) =>
      redactWriteEcho(entity, row, fieldVisibilityFor(req, entity, accountId)),
  });
}

function buildPlatformRouteDependencies(input: RegisterApiRoutesInput) {
  const { db, runtime, config, options, rootHelpers, sessionResolution, authorization } = input;
  const { accountAdminPort, accountFlows, auditDrainer, drainProductAudit, healthStmt, masquerades, store } = runtime;
  const { auditSink, auth, authMode, logOn } = config;
  const { accountFail, securityEvent, sendFail } = rootHelpers;
  const { resolveIncomingSession } = sessionResolution;
  const { authorize, resolveEffectiveRole } = authorization;
  return {
    system: {
      securityEvent,
      healthStatement: healthStmt,
      auditDrainer,
      auditSink,
      ...(options.backupHealth === undefined ? {} : { backupHealth: options.backupHealth }),
      ...(options.internalTlsExpiresAt === undefined ? {} : { internalTlsExpiresAt: options.internalTlsExpiresAt }),
      ...(options.internalTlsFingerprintSha256 === undefined
        ? {}
        : { internalTlsFingerprintSha256: options.internalTlsFingerprintSha256 }),
      isInitialized: () => isInitialized(db),
    },
    authProxy: {
      authMode,
      auth,
      db,
      multiAccount: options.multiAccount === true,
      requireMfa: options.requireMfa === true,
      accountAdminPort,
      masquerades,
      resolveIncomingSession,
      sessionUserFromApplicationSession: buildSessionUser,
      sessionSatisfiesRequiredMfa: hasRequiredSessionMfa,
      toWebHeaders,
      logOn,
    },
    state: {
      db,
      store,
      authMode,
      auth,
      multiAccount: options.multiAccount === true,
      ...(options.bootstrapToken === undefined ? {} : { bootstrapToken: options.bootstrapToken }),
      accountAdminPort,
      accountFlows,
      masquerades,
      authorize,
      resolveEffectiveRole,
      accountCommand: createAccountCommand,
      accountFail,
      sendFail,
      drainProductAudit,
    },
  };
}

function registerPlatformRoutes(input: RegisterRouteGroupInput): void {
  const { childApp: app, runtime, config, options, rootHelpers, authorization } = input;
  const dependencies = buildPlatformRouteDependencies(input);
  const { accountAdminPort, identityPort } = runtime;
  const { application, auth, authMode } = config;
  registerSystemRoutes(app, { ...dependencies.system, section: "public" });
  registerAuthProxyRoutes(app, { ...dependencies.authProxy, section: "identity" });
  if (authMode !== "off" && auth) {
    registerSsoCutoverRoutes(app, {
      auth,
      authMode,
      identity: identityPort as SsoCutoverIdentityPort,
      administration: accountAdminPort,
      applicationId: application.applicationId,
      openSignup: options.allowOpenSignup === true,
      authorize: authorization.authorizeAllowed,
      fail: rootHelpers.accountFail,
      toWebHeaders,
    });
    registerAuthProxyRoutes(app, { ...dependencies.authProxy, section: "proxy" });
  }
  registerStateRoutes(app, { ...dependencies.state, section: "read" });
  registerSystemRoutes(app, { ...dependencies.system, section: "meta" });
  registerStateRoutes(app, { ...dependencies.state, section: "org" });
}

export function registerApiRoutes(input: RegisterApiRoutesInput): void {
  const { app } = input;
  // Every route below registers through a child plugin, NOT directly on the root:
  // @fastify/rate-limit attaches to routes via an onRoute hook that only exists once the
  // plugin LOADS (at ready(), in registration order) — a route declared straight on the
  // root would register first and silently escape the limiter. The child loads after it,
  // so its routes are seen, and it inherits the root CORS hook + error handler. The
  // callback shadows `app` deliberately: the route code is identical without the wrapper.
  void app.register(async (app) => {
    registerPlatformRoutes({ ...input, childApp: app });

    registerAccountControlRoutes({ ...input, childApp: app });
    registerDataRoutes({ ...input, childApp: app });
  });
}
