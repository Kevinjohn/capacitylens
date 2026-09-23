import type { Db } from "../db";

/** Row presence is the only persisted company-wide dismissal state. */
export const GETTING_STARTED_DISMISSALS_V45_SQL = `CREATE TABLE IF NOT EXISTS account_getting_started_dismissals (
  accountId TEXT NOT NULL PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE
) STRICT;`;

export function readGettingStartedDismissed(db: Db, accountId: string): boolean {
  return (
    db.prepare("SELECT 1 FROM account_getting_started_dismissals WHERE accountId = ?").get(accountId) !== undefined
  );
}

export function dismissGettingStarted(db: Db, accountId: string): void {
  db.prepare("INSERT OR IGNORE INTO account_getting_started_dismissals (accountId) VALUES (?)").run(accountId);
}
