import type { PrincipalId } from "@capacitylens/shared/account/types";
import type { Db } from "../../db";

/**
 * Returns the principal’s current security revision, defaulting to zero before its first change.
 */
export function readSecurityRevision(db: Db, principalId: PrincipalId): number {
  const row = db.prepare(`SELECT revision FROM account_security_revisions WHERE principalId = ?`).get(principalId) as
    { revision?: number } | undefined;
  return Number(row?.revision ?? 0);
}

/**
 * Increments and returns the principal’s security revision.
 */
export function bumpSecurityRevision(db: Db, principalId: PrincipalId, now = new Date().toISOString()): number {
  db.prepare(
    `
    INSERT INTO account_security_revisions (principalId, revision, updatedAt)
    VALUES (?, 1, ?)
    ON CONFLICT(principalId) DO UPDATE SET
      revision = account_security_revisions.revision + 1,
      updatedAt = excluded.updatedAt
  `,
  ).run(principalId, now);
  return readSecurityRevision(db, principalId);
}

/**
 * Deletes the principal’s security revision during identity cleanup.
 */
export function removeSecurityRevision(db: Db, principalId: PrincipalId): void {
  db.prepare(`DELETE FROM account_security_revisions WHERE principalId = ?`).run(principalId);
}
