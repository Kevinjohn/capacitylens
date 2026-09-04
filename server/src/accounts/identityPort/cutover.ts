import { enqueueAudit } from "../../auditOutbox";
import { tx } from "../../txn";
import { applicationSessionHandle } from "../sessionHandle";
import type { IdentityPortContext } from "./contracts";
import type { SsoCutoverIdentityPort } from "./contracts";
import { timestampMs } from "./instants";

export function createCutover(
  context: Pick<
    IdentityPortContext,
    | "input"
    | "sessionTableExists"
    | "userTableExists"
    | "verificationTableExists"
    | "accountSessionAssuranceTableExists"
    | "revokePrincipalSessionsInTx"
  >,
): Pick<SsoCutoverIdentityPort, "revokeAllForSsoCutover"> {
  const {
    input,
    sessionTableExists,
    userTableExists,
    verificationTableExists,
    accountSessionAssuranceTableExists,
    revokePrincipalSessionsInTx,
  } = context;
  const { applicationId, db } = input;

  return {
    async revokeAllForSsoCutover(assertReady) {
      const masqueradeHandles: string[] = [];
      const result = tx(
        db,
        () => {
          // Take the writer reservation before the final readiness read. Otherwise another process
          // could admit a blocker or create a password session between preflight and revocation.
          assertReady();
          const sessionRows = sessionTableExists(db)
            ? (db.prepare(`SELECT token, userId FROM session`).all() as Array<{ token: string; userId: string }>)
            : [];
          const verificationRows = verificationTableExists(db)
            ? (db.prepare(`SELECT value, expiresAt FROM verification`).all() as Array<{
                value: string;
                expiresAt: string | number;
              }>)
            : [];
          const ceremonies = verificationRows.length;
          const now = Date.now();
          const principals = userTableExists(db)
            ? (db.prepare(`SELECT id FROM user`).all() as Array<{ id: string }>).map(({ id }) => id)
            : [];
          const principalIds = new Set(principals);
          const activeCutoverCeremonies = verificationRows.filter(({ value, expiresAt }) => {
            const expiry = timestampMs(expiresAt);
            return principalIds.has(value) && (!Number.isFinite(expiry) || expiry > now);
          }).length;
          const activated =
            db.prepare(`SELECT 1 FROM capacitylens_sso_cutover_state WHERE applicationId = ?`).get(applicationId) !==
            undefined;
          const assuranceBySession = new Map(
            accountSessionAssuranceTableExists(db)
              ? (
                  db.prepare(`SELECT sessionId, assurance FROM account_session_assurance`).all() as Array<{
                    sessionId: string;
                    assurance: string;
                  }>
                ).map((row) => [row.sessionId, row.assurance] as const)
              : [],
          );
          // The durable application-scoped marker distinguishes the first cutover from a clean
          // restart even when staging left no live password sessions or ceremonies. A later
          // rollback-created password/MFA session still re-establishes the post-cutover boundary.
          const requiresCutover =
            !activated ||
            activeCutoverCeremonies > 0 ||
            sessionRows.some(
              ({ token }) => assuranceBySession.get(applicationSessionHandle(applicationId, token)) !== "federated",
            );
          if (!requiresCutover) return { sessions: 0, ceremonies: 0 };
          for (const principalId of principals) {
            masqueradeHandles.push(
              ...revokePrincipalSessionsInTx(db, applicationId, principalId, input.masqueradeSessions),
            );
          }
          if (verificationTableExists(db)) db.prepare(`DELETE FROM verification`).run();
          db.prepare(`DELETE FROM account_session_assurance`).run();
          db.prepare(`DELETE FROM capacitylens_federated_link_ceremonies`).run();
          const occurredAt = new Date().toISOString();
          if (!activated) {
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
          if (sessionRows.length > 0) {
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
          return { sessions: sessionRows.length, ceremonies };
        },
        "immediate",
      );
      input.masqueradeSessions?.commit(masqueradeHandles);
      return result;
    },
  };
}
