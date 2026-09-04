import type { FastifyReply } from "fastify";
import { DEMO_USER } from "../auth";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import { betterAuthIdentityPort } from "../accounts/betterAuthIdentityPort";
import { sqliteAccountAdminPort } from "../accounts/sqliteAccountAdminPort";
import { localAccountFlows } from "../accounts/localAccountFlows";
import { KeyedOperationLock } from "../accounts/operationLock";
import { trustedLocalIdentityPort } from "../accounts/trustedLocalIdentityPort";
import { applicationSessionHandle } from "../accounts/sessionHandle";
import { enqueueMasqueradeEndAudit } from "./masqueradeRoutes";
import { MasqueradeRegistry, type StoredMasqueradeRecord } from "../masqueradeRegistry";
import { type MasqueradeEndReason } from "@capacitylens/shared/domain/masquerade";
import { eraseWorkspaceProductDataInTx } from "../erasure";
import { type Db } from "../db";
import { sqliteTenantStore } from "../tenantStore";
import { tx } from "../txn";
import { type AuditRecord } from "../audit";
import { enqueueAudit } from "../auditOutbox";
import { createAuditOutboxDrainer } from "../auditOutboxDrainer";
import type { resolveAppConfig } from "./appConfig";
import type { AppOptions } from "../app";

export function createAppRuntime(db: Db, config: ReturnType<typeof resolveAppConfig>, opts: AppOptions) {
  const { authMode, auth, application, auditSink } = config;
  // Recover records committed before a prior process stopped between SQLite COMMIT and delivery.
  // A sink failure remains a soft health signal and leaves the oldest row queued for the next
  // request/restart; malformed durable rows throw because silently skipping one would break the
  // completeness contract the outbox exists to provide.
  const auditDrainer = createAuditOutboxDrainer(db, auditSink, () => {
    console.error(JSON.stringify({ level: "error", event: "audit_outbox_background_drain_failed" }));
  });
  const repliesWithAuditDrain = new WeakSet<FastifyReply>();
  auditDrainer.drainOnce();
  // Account coordinators write stable event ids through the same durable outbox as product
  // mutations. Their append boundary means "durably accepted", not "already delivered"; the
  // response hook below performs best-effort delivery after any enclosing transaction commits.
  const accountAudit = {
    append: (event: AccountAuditEvent) => {
      enqueueAudit(db, event, event.id);
      return true;
    },
  };
  const masquerades = new MasqueradeRegistry({
    expired: (record) => enqueueMasqueradeEndAudit(accountAudit, application.applicationId, record, "session_expired"),
  });
  const prepareMasqueradeUsers = (userIds: readonly string[], reason: "session_revoked"): readonly string[] => {
    const handles = [...new Set(userIds.flatMap((userId) => masquerades.sessionHandlesForUser(userId)))];
    for (const sessionHandle of handles) {
      masquerades.prepareEnd(sessionHandle, null, (record) =>
        enqueueMasqueradeEndAudit(accountAudit, application.applicationId, record, reason),
      );
    }
    return handles;
  };
  const masqueradeSessionLifecycle = {
    prepare: (sessionHandles: readonly string[], reason: "session_expired" | "session_revoked") => {
      for (const sessionHandle of sessionHandles) {
        masquerades.prepareEnd(sessionHandle, null, (record) =>
          enqueueMasqueradeEndAudit(accountAudit, application.applicationId, record, reason),
        );
      }
    },
    prepareUsers: prepareMasqueradeUsers,
    commit: (sessionHandles: readonly string[]) => masquerades.commitEnd(sessionHandles),
  };
  auth?.setSessionDeletionLifecycle?.({
    prepareSession: (sessionToken, reason) => {
      const handle = applicationSessionHandle(application.applicationId, sessionToken);
      masqueradeSessionLifecycle.prepare([handle], reason);
      return [handle];
    },
    prepareUser: (userId) => prepareMasqueradeUsers([userId], "session_revoked"),
    commit: masqueradeSessionLifecycle.commit,
  });
  const accountLock = new KeyedOperationLock();
  const identityPort =
    auth && authMode !== "off"
      ? betterAuthIdentityPort({
          applicationId: application.applicationId,
          auth,
          authMode,
          db,
          masqueradeSessions: masqueradeSessionLifecycle,
        })
      : trustedLocalIdentityPort({
          id: DEMO_USER.id,
          displayName: DEMO_USER.name,
          email: DEMO_USER.email,
          emailVerified: true,
          linkedSubject: null,
        });
  const accountAdminPort = sqliteAccountAdminPort({
    applicationId: application.applicationId,
    db,
    lock: accountLock,
    trustedLocal: authMode === "off",
    requireMfa: authMode === "password" && opts.requireMfa === true,
    audit: accountAudit,
  });
  const accountFlows = localAccountFlows({
    applicationId: application.applicationId,
    db,
    identity: identityPort,
    administration: accountAdminPort,
    lock: accountLock,
    eraseProductWorkspaceInTx: (workspaceId) => eraseWorkspaceProductDataInTx(db, workspaceId),
    audit: accountAudit,
  });

  // Deep mode prepares the trivial read ONCE, here in the synchronous factory body while
  // the DB is known-open; a later closed/corrupt/locked DB makes get() throw at request
  // time, which is exactly the signal the uptime monitor needs (a bare { ok: true } from
  // a server whose DB is broken is a lie).
  const healthStmt = opts.healthDeep === true ? db.prepare("SELECT 1") : null;

  // Forward coordinator-owned account/control events that do not represent AppData mutations.
  // Product mutations use commitProductAudit below so their audit row shares the data transaction.
  // append() never throws (see audit.ts); a degraded direct sink remains a soft health signal.
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

  // The tenant-scoping storage seam: account-keyed reads, validation projections and lifecycle
  // operations enforce the no-cross-tenant contract in one shared-SQLite implementation. Built once
  // here (factory state, like healthStmt) so the same instance backs every request.
  const store = sqliteTenantStore(db);

  const endMasquerade = (record: Readonly<StoredMasqueradeRecord>, reason: MasqueradeEndReason): void => {
    masquerades.end(record.sessionHandle, null, (ending) =>
      enqueueMasqueradeEndAudit(accountAudit, application.applicationId, ending, reason),
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
