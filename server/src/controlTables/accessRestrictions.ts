import type { Role } from "@capacitylens/shared/account/types";
import type { Db } from "../db";

export interface AccessRestriction {
  accountId: string;
  principalId: string;
  verifiedEmail: string | null;
  role: Role;
  createdAt: string;
}

export function provenEmail(db: Db, principalId: string): string | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user'").get()) return null;
  const row = db
    .prepare(
      `SELECT proof.email FROM identity_email_proofs AS proof
    JOIN user AS principal ON principal.id = proof.principalId
    WHERE proof.principalId = ? AND proof.email = lower(trim(principal.email))`,
    )
    .get(principalId) as { email: string } | undefined;
  return row?.email ?? null;
}

export function listAccessRestrictions(db: Db, accountId: string): AccessRestriction[] {
  return db
    .prepare(
      `SELECT accountId, principalId, verifiedEmail, role, createdAt
    FROM account_access_restrictions WHERE accountId = ? ORDER BY createdAt, principalId`,
    )
    .all(accountId) as unknown as AccessRestriction[];
}

export function getAccessRestriction(db: Db, accountId: string, principalId: string): AccessRestriction | null {
  return (
    (db
      .prepare(
        `SELECT accountId, principalId, verifiedEmail, role, createdAt
    FROM account_access_restrictions WHERE accountId = ? AND principalId = ?`,
      )
      .get(accountId, principalId) as AccessRestriction | undefined) ?? null
  );
}

export function matchingAccessRestrictions(db: Db, accountId: string, principalId: string): AccessRestriction[] {
  const email = provenEmail(db, principalId);
  return db
    .prepare(
      `SELECT accountId, principalId, verifiedEmail, role, createdAt
    FROM account_access_restrictions WHERE accountId = ? AND (principalId = ? OR verifiedEmail = ?)`,
    )
    .all(accountId, principalId, email) as unknown as AccessRestriction[];
}

export function isAccessRestricted(db: Db, accountId: string, principalId: string): boolean {
  return matchingAccessRestrictions(db, accountId, principalId).length > 0;
}

/** Keep restrictions independent of membership deletion and identity erasure. Caller owns the write transaction. */
export function disableAccess(db: Db, input: { accountId: string; principalId: string; role: Role }): void {
  const { accountId, principalId, role } = input;
  const email = provenEmail(db, principalId);
  db.prepare(
    `INSERT INTO account_access_restrictions (accountId, principalId, verifiedEmail, role, createdAt)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(accountId, principalId) DO NOTHING`,
  ).run(accountId, principalId, email, role, new Date().toISOString());
}

/** An explicit repeat Disable may add newly established proof after the caller's alias guards. */
export function captureRestrictionEmail(db: Db, accountId: string, principalId: string): void {
  const email = provenEmail(db, principalId);
  if (email === null) return;
  db.prepare(
    `UPDATE account_access_restrictions SET verifiedEmail = ?
    WHERE accountId = ? AND principalId = ? AND verifiedEmail IS NULL`,
  ).run(email, accountId, principalId);
}

export function enableAccess(db: Db, accountId: string, principalId: string): boolean {
  return (
    db
      .prepare(`DELETE FROM account_access_restrictions WHERE accountId = ? AND principalId = ?`)
      .run(accountId, principalId).changes > 0
  );
}

export function removeAccessRestrictionsForAccount(db: Db, accountId: string): void {
  db.prepare(`DELETE FROM account_access_restrictions WHERE accountId = ?`).run(accountId);
}
