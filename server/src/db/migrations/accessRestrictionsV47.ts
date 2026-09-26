import { normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { defineMigration } from "../migrationLedger";
import { tableHasColumns } from "../introspection";

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
    "copy-disabled-members-with-proven-email:v1",
    "restore-disabled-nonowner-lifecycle-to-active:v1",
  ].join("\n-- migration component --\n"),
  (db) => {
    db.exec(ACCESS_RESTRICTIONS_V47_SQL);
    const hasUser = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user'").get();
    const users =
      hasUser && tableHasColumns(db, "user", ["emailVerified"])
        ? (db.prepare("SELECT id, email, emailVerified FROM user").all() as Array<{
            id: string;
            email: string;
            emailVerified: number;
          }>)
        : [];
    const byId = new Map(users.map((user) => [user.id, user]));
    const disabled = db
      .prepare("SELECT accountId, userId, role, createdAt FROM account_members WHERE status = 'disabled'")
      .all() as Array<{ accountId: string; userId: string; role: string; createdAt: string }>;
    const insert = db.prepare(`INSERT INTO account_access_restrictions
      (accountId, principalId, verifiedEmail, role, createdAt) VALUES (?, ?, ?, ?, ?)`);
    for (const member of disabled) {
      const user = byId.get(member.userId);
      insert.run(
        member.accountId,
        member.userId,
        user?.emailVerified === 1 ? normalizeAccountEmail(user.email) : null,
        member.role,
        member.createdAt,
      );
    }
    // A legacy disabled Owner cannot become a second active Owner under the unique index.
    db.prepare("UPDATE account_members SET status = 'active' WHERE status = 'disabled' AND role <> 'owner'").run();
  },
);
