import type { Role } from "@capacitylens/shared/account/types";
import { normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { Db } from "../db";
import { bumpSecurityRevision } from "../accounts/state";
import { revokeResetTokensForUser } from "../auth";
import { terminaliseLiveRequestsForMember } from "./ownershipTransfers";

export interface AccessRestriction {
  accountId: string;
  principalId: string;
  verifiedEmail: string | null;
  role: Role;
  createdAt: string;
}

function provenEmail(db: Db, principalId: string): string | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user'").get()) return null;
  const user = db.prepare("SELECT email, emailVerified FROM user WHERE id = ?").get(principalId) as
    { email: string; emailVerified: number } | undefined;
  return user?.emailVerified === 1 ? normalizeAccountEmail(user.email) : null;
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
  revokeResetTokensForUser(db, principalId);
  bumpSecurityRevision(db, principalId);
  terminaliseLiveRequestsForMember({
    db,
    accountId,
    userId: principalId,
    reason: "participant_membership_changed",
    now: new Date().toISOString(),
  });
}

export function enableAccess(db: Db, accountId: string, principalId: string): boolean {
  const changed =
    db
      .prepare(`DELETE FROM account_access_restrictions WHERE accountId = ? AND principalId = ?`)
      .run(accountId, principalId).changes > 0;
  if (changed) bumpSecurityRevision(db, principalId);
  return changed;
}

export function removeAccessRestrictionsForAccount(db: Db, accountId: string): void {
  db.prepare(`DELETE FROM account_access_restrictions WHERE accountId = ?`).run(accountId);
}
