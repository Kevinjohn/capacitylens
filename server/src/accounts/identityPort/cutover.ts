import { enqueueAudit } from "../../auditOutbox";
import type { Db } from "../../db";
import { tx } from "../../txn";
import { buildApplicationSessionHandle } from "../buildApplicationSessionHandle";
import type { IdentityPortContext, MasqueradeSessionLifecycle, SsoCutoverIdentityPort } from "./contracts";
import { parseTimestampMilliseconds } from "./instants";

type CutoverContext = Pick<
  IdentityPortContext,
  | "input"
  | "sessionTableExists"
  | "userTableExists"
  | "verificationTableExists"
  | "accountSessionAssuranceTableExists"
  | "revokePrincipalSessionsInTx"
>;

interface CutoverInventory {
  activated: boolean;
  ceremonies: number;
  principals: readonly string[];
  requiresCutover: boolean;
  sessions: number;
}

interface ReadCutoverInventoryOptions {
  applicationId: string;
  context: CutoverContext;
  db: Db;
}

function readCutoverInventory({ applicationId, context, db }: ReadCutoverInventoryOptions): CutoverInventory {
  const sessionRows = context.sessionTableExists(db)
    ? (db.prepare(`SELECT token, userId FROM session`).all() as Array<{ token: string; userId: string }>)
    : [];
  const verificationRows = context.verificationTableExists(db)
    ? (db.prepare(`SELECT value, expiresAt FROM verification`).all() as Array<{
        value: string;
        expiresAt: string | number;
      }>)
    : [];
  const principals = context.userTableExists(db)
    ? (db.prepare(`SELECT id FROM user`).all() as Array<{ id: string }>).map(({ id }) => id)
    : [];
  const principalIds = new Set(principals);
  const now = Date.now();
  const activeCutoverCeremonies = verificationRows.filter(({ value, expiresAt }) => {
    const expiry = parseTimestampMilliseconds(expiresAt);
    return principalIds.has(value) && (expiry === null || expiry > now);
  }).length;
  const activated =
    db.prepare(`SELECT 1 FROM capacitylens_sso_cutover_state WHERE applicationId = ?`).get(applicationId) !== undefined;
  const assuranceBySession = new Map(
    context.accountSessionAssuranceTableExists(db)
      ? (
          db.prepare(`SELECT sessionId, assurance FROM account_session_assurance`).all() as Array<{
            sessionId: string;
            assurance: string;
          }>
        ).map((row) => [row.sessionId, row.assurance] as const)
      : [],
  );
  const requiresSessionRevocation = sessionRows.some(
    ({ token }) => assuranceBySession.get(buildApplicationSessionHandle(applicationId, token)) !== "federated",
  );
  // The durable application-scoped marker distinguishes the first cutover from a clean restart.
  // A later rollback-created password/MFA session still re-establishes the cutover boundary.
  return {
    activated,
    ceremonies: verificationRows.length,
    principals,
    requiresCutover: !activated || activeCutoverCeremonies > 0 || requiresSessionRevocation,
    sessions: sessionRows.length,
  };
}

interface RevokeCutoverSessionsOptions {
  applicationId: string;
  context: CutoverContext;
  db: Db;
  lifecycle?: MasqueradeSessionLifecycle | undefined;
  principalIds: readonly string[];
}

function revokeCutoverSessions({
  applicationId,
  context,
  db,
  lifecycle,
  principalIds,
}: RevokeCutoverSessionsOptions): readonly string[] {
  const masqueradeHandles: string[] = [];
  for (const principalId of principalIds) {
    masqueradeHandles.push(...context.revokePrincipalSessionsInTx({ db, applicationId, principalId, lifecycle }));
  }
  return masqueradeHandles;
}

function clearCutoverCeremonies(context: CutoverContext, db: Db): void {
  if (context.verificationTableExists(db)) db.prepare(`DELETE FROM verification`).run();
  db.prepare(`DELETE FROM account_session_assurance`).run();
  db.prepare(`DELETE FROM capacitylens_federated_link_ceremonies`).run();
}

interface RecordCutoverAuditOptions {
  applicationId: string;
  db: Db;
  occurredAt: string;
}

function recordCutoverActivation({ applicationId, db, occurredAt }: RecordCutoverAuditOptions): void {
  db.prepare(`INSERT INTO capacitylens_sso_cutover_state (applicationId, activatedAt) VALUES (?, ?)`).run(
    applicationId,
    occurredAt,
  );
  const activationAuditId = `sso-cutover:${applicationId}:${occurredAt}`;
  enqueueAudit(
    db,
    {
      id: activationAuditId,
      occurredAt,
      applicationId,
      workspaceId: null,
      actorPrincipalId: null,
      targetPrincipalId: null,
      commandId: null,
      action: "identity.sso_cutover_activated",
      outcome: "success",
      changedFields: ["verificationCeremonies", "authenticationMode"],
    },
    activationAuditId,
  );
}

function recordCutoverSessionRevocation({ applicationId, db, occurredAt }: RecordCutoverAuditOptions): void {
  const revocationAuditId = `sso-cutover-sessions:${occurredAt}`;
  enqueueAudit(
    db,
    {
      id: revocationAuditId,
      occurredAt,
      applicationId,
      workspaceId: null,
      actorPrincipalId: null,
      targetPrincipalId: null,
      commandId: null,
      action: "identity.sessions_revoked",
      outcome: "success",
      changedFields: ["sessions"],
    },
    revocationAuditId,
  );
}

interface ExecuteCutoverOptions {
  assertReady(): void;
  context: CutoverContext;
}

interface ExecuteCutoverResult {
  ceremonies: number;
  masqueradeHandles: readonly string[];
  sessions: number;
}

function executeCutover({ assertReady, context }: ExecuteCutoverOptions): ExecuteCutoverResult {
  const { applicationId, db, masqueradeSessions } = context.input;
  return tx(
    db,
    () => {
      // Take the writer reservation before the final readiness read. Otherwise another process
      // could admit a blocker or create a password session between preflight and revocation.
      assertReady();
      const inventory = readCutoverInventory({ applicationId, context, db });
      if (!inventory.requiresCutover) {
        return { ceremonies: 0, masqueradeHandles: [], sessions: 0 };
      }
      const masqueradeHandles = revokeCutoverSessions({
        applicationId,
        context,
        db,
        lifecycle: masqueradeSessions,
        principalIds: inventory.principals,
      });
      clearCutoverCeremonies(context, db);
      const occurredAt = new Date().toISOString();
      if (!inventory.activated) recordCutoverActivation({ applicationId, db, occurredAt });
      if (inventory.sessions > 0) recordCutoverSessionRevocation({ applicationId, db, occurredAt });
      return {
        ceremonies: inventory.ceremonies,
        masqueradeHandles,
        sessions: inventory.sessions,
      };
    },
    "immediate",
  );
}

export function createCutover(context: CutoverContext): Pick<SsoCutoverIdentityPort, "revokeAllForSsoCutover"> {
  return {
    async revokeAllForSsoCutover(assertReady) {
      const { ceremonies, masqueradeHandles, sessions } = executeCutover({ assertReady, context });
      context.input.masqueradeSessions?.commit(masqueradeHandles);
      return { sessions, ceremonies };
    },
  };
}
