import type { FastifyReply } from "fastify";
import { DEMO_USER } from "../auth";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import { createBetterAuthIdentityPort } from "../accounts/betterAuthIdentityPort";
import { createSqliteAccountAdminPort } from "../accounts/sqliteAccountAdminPort";
import { createLocalAccountFlows } from "../accounts/createLocalAccountFlows";
import { KeyedOperationLock } from "../accounts/KeyedOperationLock";
import { createTrustedLocalIdentityPort } from "../accounts/createTrustedLocalIdentityPort";
import { buildApplicationSessionHandle } from "../accounts/buildApplicationSessionHandle";
import { enqueueMasqueradeEndAudit } from "./masqueradeRoutes";
import { MasqueradeRegistry, type StoredMasqueradeRecord } from "../MasqueradeRegistry";
import { type MasqueradeEndReason } from "@capacitylens/shared/domain/masquerade";
import { eraseWorkspaceProductDataInTx } from "../erasure";
import { type Db } from "../db";
import { createSqliteTenantStore } from "../tenantStore";
import { tx } from "../txn";
import { type AuditRecord } from "../audit";
import { enqueueAudit } from "../auditOutbox";
import { createAuditOutboxDrainer } from "../auditOutboxDrainer";
import type { resolveAppConfig } from "./appConfig";
import type { AppOptions } from "../app";

interface CreateAuditRuntimeInput {
  db: Db;
  auditSink: ReturnType<typeof resolveAppConfig>["auditSink"];
}

function createAuditRuntime({ db, auditSink }: CreateAuditRuntimeInput) {
  const auditDrainer = createAuditOutboxDrainer(db, auditSink, () => {
    console.error(JSON.stringify({ level: "error", event: "audit_outbox_background_drain_failed" }));
  });
  const repliesWithAuditDrain = new WeakSet<FastifyReply>();
  auditDrainer.drainOnce();
  const accountAudit = {
    append: (event: AccountAuditEvent) => {
      enqueueAudit(db, event, event.id);
      return true;
    },
  };
  const audit = (reply: FastifyReply, record: AuditRecord): void => {
    if (!auditSink.append(record)) reply.header("x-capacitylens-audit-warning", "true");
  };
  const drainProductAudit = (reply: FastifyReply): boolean => {
    repliesWithAuditDrain.add(reply);
    const ok = auditDrainer.drainOnce();
    if (!ok) reply.header("x-capacitylens-audit-warning", "true");
    return ok;
  };
  const commitProductAudit = (reply: FastifyReply, record: AuditRecord, mutation: () => void): boolean => {
    tx(
      db,
      () => {
        mutation();
        enqueueAudit(db, record);
      },
      "immediate",
    );
    return drainProductAudit(reply);
  };
  return { auditDrainer, repliesWithAuditDrain, accountAudit, audit, drainProductAudit, commitProductAudit };
}

interface CreateAccountRuntimeInput {
  db: Db;
  config: ReturnType<typeof resolveAppConfig>;
  options: AppOptions;
  accountAudit: ReturnType<typeof createAuditRuntime>["accountAudit"];
}

interface CreateAccountPortsInput extends CreateAccountRuntimeInput {
  masqueradeSessions: NonNullable<Parameters<typeof createBetterAuthIdentityPort>[0]["masqueradeSessions"]>;
}

function createAccountPorts({ db, config, options, accountAudit, masqueradeSessions }: CreateAccountPortsInput) {
  const { authMode, auth, application } = config;
  const accountLock = new KeyedOperationLock();
  const identityPort =
    auth && authMode !== "off"
      ? createBetterAuthIdentityPort({
          applicationId: application.applicationId,
          auth,
          authMode,
          db,
          masqueradeSessions,
        })
      : createTrustedLocalIdentityPort({
          id: DEMO_USER.id,
          displayName: DEMO_USER.name,
          email: DEMO_USER.email,
          emailVerified: true,
          linkedSubject: null,
        });
  const accountAdminPort = createSqliteAccountAdminPort({
    applicationId: application.applicationId,
    db,
    lock: accountLock,
    trustedLocal: authMode === "off",
    requireMfa: authMode === "password" && options.requireMfa === true,
    audit: accountAudit,
  });
  const accountFlows = createLocalAccountFlows({
    applicationId: application.applicationId,
    db,
    identity: identityPort,
    administration: accountAdminPort,
    lock: accountLock,
    eraseProductWorkspaceInTx: (workspaceId) => eraseWorkspaceProductDataInTx(db, workspaceId),
    audit: accountAudit,
  });
  return { accountLock, identityPort, accountAdminPort, accountFlows };
}

function createAccountRuntime({ db, config, options, accountAudit }: CreateAccountRuntimeInput) {
  const { auth, application } = config;
  const masquerades = new MasqueradeRegistry({
    expired: (record) =>
      enqueueMasqueradeEndAudit({
        accountAudit,
        applicationId: application.applicationId,
        record,
        reason: "session_expired",
      }),
  });
  const prepareMasqueradeUsers = (userIds: readonly string[], reason: "session_revoked"): readonly string[] => {
    const handles = [...new Set(userIds.flatMap((userId) => masquerades.listSessionHandlesForUser(userId)))];
    for (const sessionHandle of handles)
      masquerades.prepareEnd(sessionHandle, null, (record) =>
        enqueueMasqueradeEndAudit({ accountAudit, applicationId: application.applicationId, record, reason }),
      );
    return handles;
  };
  const masqueradeSessionLifecycle = {
    prepare: (sessionHandles: readonly string[], reason: "session_expired" | "session_revoked") => {
      for (const sessionHandle of sessionHandles)
        masquerades.prepareEnd(sessionHandle, null, (record) =>
          enqueueMasqueradeEndAudit({ accountAudit, applicationId: application.applicationId, record, reason }),
        );
    },
    prepareUsers: prepareMasqueradeUsers,
    commit: (sessionHandles: readonly string[]) => masquerades.commitEnd(sessionHandles),
  };
  auth?.setSessionDeletionLifecycle?.({
    prepareSession: (sessionToken, reason) => {
      const handle = buildApplicationSessionHandle(application.applicationId, sessionToken);
      masqueradeSessionLifecycle.prepare([handle], reason);
      return [handle];
    },
    prepareUser: (userId) => prepareMasqueradeUsers([userId], "session_revoked"),
    commit: masqueradeSessionLifecycle.commit,
  });
  const accountPorts = createAccountPorts({
    db,
    config,
    options,
    accountAudit,
    masqueradeSessions: masqueradeSessionLifecycle,
  });
  const { accountLock, identityPort, accountAdminPort, accountFlows } = accountPorts;
  return {
    masquerades,
    prepareMasqueradeUsers,
    masqueradeSessionLifecycle,
    accountLock,
    identityPort,
    accountAdminPort,
    accountFlows,
  };
}

export function createAppRuntime(db: Db, config: ReturnType<typeof resolveAppConfig>, options: AppOptions) {
  const { application, auditSink } = config;
  // Recover records committed before a prior process stopped between SQLite COMMIT and delivery.
  // A sink failure remains a soft health signal and leaves the oldest row queued for the next
  // request/restart; malformed durable rows throw because silently skipping one would break the
  // completeness contract the outbox exists to provide.
  // Account coordinators write stable event ids through the same durable outbox as product
  // mutations. Their append boundary means "durably accepted", not "already delivered"; the
  // response hook below performs best-effort delivery after any enclosing transaction commits.
  const { auditDrainer, repliesWithAuditDrain, accountAudit, audit, drainProductAudit, commitProductAudit } =
    createAuditRuntime({ db, auditSink });
  const accountRuntime = createAccountRuntime({ db, config, options, accountAudit });
  const {
    masquerades,
    prepareMasqueradeUsers,
    masqueradeSessionLifecycle,
    accountLock,
    identityPort,
    accountAdminPort,
    accountFlows,
  } = accountRuntime;
  // Deep mode prepares the trivial read ONCE, here in the synchronous factory body while
  // the DB is known-open; a later closed/corrupt/locked DB makes get() throw at request
  // time, which is exactly the signal the uptime monitor needs (a bare { ok: true } from
  // a server whose DB is broken is a lie).
  const healthStmt = options.healthDeep === true ? db.prepare("SELECT 1") : null;

  // The tenant-scoping storage seam: account-keyed reads, validation projections and lifecycle
  // operations enforce the no-cross-tenant contract in one shared-SQLite implementation. Built once
  // here (factory state, like healthStmt) so the same instance backs every request.
  const store = createSqliteTenantStore(db);

  const endMasquerade = (record: Readonly<StoredMasqueradeRecord>, reason: MasqueradeEndReason): void => {
    masquerades.end(record.sessionHandle, null, (ending) =>
      enqueueMasqueradeEndAudit({ accountAudit, applicationId: application.applicationId, record: ending, reason }),
    );
  };

  return {
    auditDrainer,
    repliesWithAuditDrain,
    accountAudit,
    masquerades,
    prepareMasqueradeUsers,
    masqueradeSessionLifecycle,
    accountLock,
    identityPort,
    accountAdminPort,
    accountFlows,
    healthStmt,
    audit,
    drainProductAudit,
    commitProductAudit,
    store,
    endMasquerade,
  };
}
