import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { anonymise } from "../scripts/rehearse/anonymise";

function requireSqlRow(row: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!row) throw new Error("Expected query to return a row");
  return row;
}

function registerAccessRestrictionRedactionTest(): void {
  it("remaps restriction principals and replaces proven addresses without losing the denial link", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE accounts (id TEXT PRIMARY KEY);
        CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT);
        CREATE TABLE account_access_restrictions
          (accountId TEXT, principalId TEXT, verifiedEmail TEXT, role TEXT, createdAt TEXT);
        INSERT INTO accounts VALUES ('source-workspace');
        INSERT INTO user VALUES ('source-principal', 'selina.kyle@example.invalid');
        INSERT INTO account_access_restrictions VALUES
          ('source-workspace', 'source-principal', 'selina.kyle@example.invalid', 'editor', '2026-01-01'),
          ('source-workspace', 'removed-principal', 'removed@example.invalid', 'viewer', '2026-01-02');
      `);
      anonymise(db);
      const workspace = requireSqlRow(db.prepare("SELECT id FROM accounts").get());
      const principal = requireSqlRow(db.prepare("SELECT id, email FROM user").get());
      const restrictions = db
        .prepare(
          `SELECT accountId, principalId, verifiedEmail, role
        FROM account_access_restrictions ORDER BY role`,
        )
        .all() as Array<Record<string, unknown>>;
      expect(restrictions).toHaveLength(2);
      expect(restrictions[0]).toMatchObject({
        accountId: workspace.id,
        principalId: principal.id,
        verifiedEmail: principal.email,
        role: "editor",
      });
      expect(restrictions[1]).toMatchObject({ accountId: workspace.id, role: "viewer" });
      expect(String(restrictions[1]?.principalId)).not.toBe("removed-principal");
      expect(String(restrictions[1]?.verifiedEmail)).toMatch(/^rehearsal-restriction-/);
      expect(JSON.stringify(restrictions)).not.toContain("selina.kyle");
      expect(JSON.stringify(restrictions)).not.toContain("removed@example.invalid");
    } finally {
      db.close();
    }
  });
}

describe("access restriction rehearsal redaction", registerAccessRestrictionRedactionTest);
