import { defineMigration } from "../migrationLedger";

export const ACCESS_RESTRICTIONS_V47_SQL = `
CREATE TABLE account_access_restrictions (
  accountId TEXT NOT NULL,
  principalId TEXT NOT NULL,
  verifiedEmail TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  createdAt TEXT NOT NULL,
  PRIMARY KEY (accountId, principalId)
);
CREATE INDEX idx_access_restrictions_email ON account_access_restrictions(accountId, verifiedEmail);
`;

export const ACCESS_RESTRICTIONS_V47_MIGRATION = defineMigration(
  47,
  "separate-company-access-restrictions",
  [
    ACCESS_RESTRICTIONS_V47_SQL,
    "copy-disabled-members-principal-only:v2",
    "restore-disabled-nonowner-lifecycle-to-active:v1",
  ].join("\n-- migration component --\n"),
  (db) => {
    db.exec(ACCESS_RESTRICTIONS_V47_SQL);
    const disabled = db
      .prepare("SELECT accountId, userId, role, createdAt FROM account_members WHERE status = 'disabled'")
      .all() as Array<{ accountId: string; userId: string; role: string; createdAt: string }>;
    const insert = db.prepare(`INSERT INTO account_access_restrictions
      (accountId, principalId, verifiedEmail, role, createdAt) VALUES (?, ?, ?, ?, ?)`);
    for (const member of disabled) {
      insert.run(member.accountId, member.userId, null, member.role, member.createdAt);
    }
    // A legacy disabled Owner cannot become a second active Owner under the unique index.
    db.prepare("UPDATE account_members SET status = 'active' WHERE status = 'disabled' AND role <> 'owner'").run();
  },
);
