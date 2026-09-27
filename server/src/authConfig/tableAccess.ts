import type { Db } from "../db";

/** Cache only table presence: a missing table may be created later on the same handle. */
export function createTableExistenceProbe(table: string): (db: Db) => boolean {
  const presence = new WeakMap<Db, true>();
  return (db: Db): boolean => {
    if (presence.get(db)) return true;
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as
      { name?: string } | undefined;
    const exists = row?.name === table;
    if (exists) presence.set(db, true);
    return exists;
  };
}

const verificationTableExists = createTableExistenceProbe("verification");

/** Privilege changes revoke all pending verification ceremonies for the principal.
 * Hashed identifiers cannot safely distinguish password resets from other ceremonies.
 * Kept independent of the auth factory so membership writes do not initialize providers. */
export function revokeResetTokensForUser(db: Db, userId: string): void {
  if (!verificationTableExists(db)) return;
  db.prepare(`DELETE FROM verification WHERE value = ?`).run(userId);
}
