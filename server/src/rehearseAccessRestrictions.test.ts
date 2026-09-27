import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { anonymise } from "../scripts/rehearse/anonymise";

function requireSqlRow(row: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!row) throw new Error("Expected query to return a row");
  return row;
}

function registerAccessRestrictionRedactionTest(): void {
  // Every identity/address variant must survive the same unique-email rehearsal write.
  // eslint-disable-next-line complexity
  it("remaps restriction principals and replaces proven addresses without losing the denial link", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE accounts (id TEXT PRIMARY KEY);
        CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT UNIQUE);
        CREATE TABLE identity_email_proofs (principalId TEXT PRIMARY KEY, email TEXT, source TEXT, provenAt TEXT);
        CREATE TABLE account_access_restrictions
          (accountId TEXT, principalId TEXT, verifiedEmail TEXT, role TEXT, createdAt TEXT);
        INSERT INTO accounts VALUES ('source-workspace');
        INSERT INTO user VALUES
          ('source-principal', 'corrected@example.invalid'),
          ('recreated-principal', 'selina.kyle@example.invalid'),
          ('case-variant-principal', 'Selina.Kyle@example.invalid');
        INSERT INTO identity_email_proofs VALUES
          ('recreated-principal', 'selina.kyle@example.invalid', 'google', '2026-01-02'),
          ('case-variant-principal', 'selina.kyle@example.invalid', 'google', '2026-01-03');
        INSERT INTO account_access_restrictions VALUES
          ('source-workspace', 'source-principal', 'selina.kyle@example.invalid', 'editor', '2026-01-01'),
          ('source-workspace', 'removed-principal', 'selina.kyle@example.invalid', 'viewer', '2026-01-02'),
          ('source-workspace', 'other-removed-principal', 'removed@example.invalid', 'admin', '2026-01-03');
      `);
      anonymise(db);
      const workspace = requireSqlRow(db.prepare("SELECT id FROM accounts").get());
      const users = db.prepare("SELECT id, email FROM user ORDER BY rowid").all() as Array<Record<string, unknown>>;
      const restrictions = db
        .prepare(
          `SELECT accountId, principalId, verifiedEmail, role
        FROM account_access_restrictions ORDER BY createdAt`,
        )
        .all() as Array<Record<string, unknown>>;
      expect(restrictions).toHaveLength(3);
      expect(users[1]?.email).not.toBe(users[2]?.email);
      expect(String(users[1]?.email).toLowerCase()).toBe(String(users[2]?.email).toLowerCase());
      expect(restrictions[0]).toMatchObject({
        accountId: workspace.id,
        principalId: users[0]?.id,
        role: "editor",
      });
      expect(String(restrictions[0]?.verifiedEmail)).toBe(String(users[1]?.email).toLowerCase());
      expect(restrictions[0]?.verifiedEmail).not.toBe(users[0]?.email);
      expect(restrictions[1]).toMatchObject({
        accountId: workspace.id,
        verifiedEmail: restrictions[0]?.verifiedEmail,
        role: "viewer",
      });
      expect(String(restrictions[1]?.principalId)).not.toBe("removed-principal");
      expect(String(restrictions[2]?.verifiedEmail)).toMatch(/^rehearsal-proof-/);
      expect(db.prepare("SELECT email FROM identity_email_proofs ORDER BY principalId").all()).toEqual([
        { email: restrictions[0]?.verifiedEmail },
        { email: restrictions[0]?.verifiedEmail },
      ]);
      expect(JSON.stringify(restrictions)).not.toContain("selina.kyle");
      expect(JSON.stringify(restrictions)).not.toContain("removed@example.invalid");
    } finally {
      db.close();
    }
  });
}

describe("access restriction rehearsal redaction", registerAccessRestrictionRedactionTest);
