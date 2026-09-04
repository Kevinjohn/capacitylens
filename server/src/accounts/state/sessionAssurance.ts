import { ACCOUNT_SESSION_ABSOLUTE_TTL_SECONDS } from "@capacitylens/shared/account/sessionPolicy";
import type { PrincipalId } from "@capacitylens/shared/account/types";
import type { Db } from "../../db";
import { cachedStatement, HOUSEKEEPING_INTERVAL_MS, lastAssuranceSweep, stableNowIso } from "./runtime";

export type RecordedSessionAssurance = "password" | "mfa" | "federated";

export interface RecordedSessionAuthentication {
  assurance: RecordedSessionAssurance;
  providerId: string | null;
}

export function recordSessionAssurance(
  db: Db,
  sessionId: string,
  principalId: PrincipalId,
  assurance: RecordedSessionAssurance,
  providerId: string | null = null,
  now = stableNowIso(),
): void {
  if ((assurance === "federated" && !providerId) || (assurance !== "federated" && providerId !== null)) {
    throw new Error("Federated session assurance requires exactly one provider id.");
  }
  // Assurance rows are keyed by a non-reversible handle rather than Better Auth's bearer token,
  // so they cannot be joined to expired sessions for cascade cleanup. Bound their lifetime to the
  // same absolute session window whenever a new session is recorded.
  const nowMs = Date.parse(now);
  const lastSweep = lastAssuranceSweep.get(db);
  if (lastSweep === undefined || nowMs - lastSweep >= HOUSEKEEPING_INTERVAL_MS) {
    db.prepare(`DELETE FROM account_session_assurance WHERE createdAt < ?`).run(
      new Date(nowMs - ACCOUNT_SESSION_ABSOLUTE_TTL_SECONDS * 1000).toISOString(),
    );
    lastAssuranceSweep.set(db, nowMs);
  }
  db.prepare(
    `
    INSERT INTO account_session_assurance (sessionId, principalId, assurance, providerId, createdAt)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET
      principalId = excluded.principalId, assurance = excluded.assurance,
      providerId = excluded.providerId, createdAt = excluded.createdAt
  `,
  ).run(sessionId, principalId, assurance, providerId, now);
}

// Explicit columns only (assurance, providerId): node:sqlite freezes a prepared statement's column
// set at prepare time, so caching is safe here precisely because this SELECT never uses `*`. Cached
// per-Db via the module-local cachedStatement (this read runs on every authenticated request via
// verifyApplicationSession); the RESULT is never cached, only the prepared statement.
const sessionAuthenticationStatement = cachedStatement(
  `SELECT assurance, providerId FROM account_session_assurance WHERE sessionId = ?`,
);

export function getSessionAuthentication(db: Db, sessionId: string): RecordedSessionAuthentication | null {
  const row = sessionAuthenticationStatement(db).get(sessionId) as
    { assurance?: RecordedSessionAssurance; providerId?: string | null } | undefined;
  return row?.assurance ? { assurance: row.assurance, providerId: row.providerId ?? null } : null;
}

export function removeSessionAssurance(db: Db, sessionId: string): void {
  db.prepare(`DELETE FROM account_session_assurance WHERE sessionId = ?`).run(sessionId);
}

export function removePrincipalSessionAssurance(db: Db, principalId: PrincipalId): void {
  db.prepare(`DELETE FROM account_session_assurance WHERE principalId = ?`).run(principalId);
}
