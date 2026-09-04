import type { PrincipalId } from "@capacitylens/shared/account/types";
import type { Db } from "../../db";

export function getSecurityRevision(db: Db, principalId: PrincipalId): number {
  const row = db.prepare(`SELECT revision FROM account_security_revisions WHERE principalId = ?`).get(principalId) as
    { revision?: number } | undefined;
  return Number(row?.revision ?? 0);
}

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
  return getSecurityRevision(db, principalId);
}

export function removeSecurityRevision(db: Db, principalId: PrincipalId): void {
  db.prepare(`DELETE FROM account_security_revisions WHERE principalId = ?`).run(principalId);
}
