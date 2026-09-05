import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { anonymise, remapIds, scrubDanglingReferences } from "../scripts/rehearse/anonymise";
import { KNOWN_COLUMNS, KNOWN_TABLES } from "../scripts/rehearse/knownColumns";
import { authFromEnv, runAuthMigrations } from "./auth";
import { openDb } from "./db";
import { PASSWORD_ENV } from "./testHelpers";

describe("rehearsal anonymisation helpers", () => {
  it.each([
    {
      schema: "CREATE TABLE unexpected_secrets (value TEXT); INSERT INTO unexpected_secrets VALUES ('source-secret');",
      offender: "unexpected_secrets",
    },
    {
      schema: "ALTER TABLE accounts ADD COLUMN secret TEXT; UPDATE accounts SET secret = 'source-secret';",
      offender: "accounts.secret",
    },
  ])("rejects $offender before changing any seeded values", ({ schema, offender }) => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(
        "CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT); INSERT INTO accounts VALUES ('source-account', 'Wayne Enterprises');",
      );
      db.exec(schema);
      const accounts = db.prepare("SELECT * FROM accounts").all();
      expect(() => anonymise(db)).toThrow(offender);
      expect(db.prepare("SELECT * FROM accounts").all()).toEqual(accounts);
      if (offender === "unexpected_secrets") {
        expect(db.prepare("SELECT value FROM unexpected_secrets").get()).toEqual({ value: "source-secret" });
      }
    } finally {
      db.close();
    }
  });

  it("remaps every present reference without colliding with an existing rehearsal id", () => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    try {
      db.exec(`
        CREATE TABLE accounts (id TEXT PRIMARY KEY);
        CREATE TABLE clients (id TEXT PRIMARY KEY, accountId TEXT REFERENCES accounts(id));
        CREATE TABLE projects (id TEXT PRIMARY KEY, accountId TEXT REFERENCES accounts(id));
        INSERT INTO accounts VALUES ('a-source-account'), ('rehearsal-accounts-1');
        INSERT INTO clients VALUES ('client-one', 'a-source-account'), ('client-two', 'rehearsal-accounts-1');
        INSERT INTO projects VALUES ('project-one', 'a-source-account'), ('project-two', 'rehearsal-accounts-1');
      `);
      remapIds(db, "accounts", "id", [
        { table: "clients", column: "accountId" },
        { table: "projects", column: "accountId" },
        { table: "missing_table", column: "accountId" },
        { table: "clients", column: "missingColumn" },
      ]);
      const accounts = db.prepare("SELECT id FROM accounts ORDER BY id").all();
      expect(accounts).toHaveLength(2);
      expect(new Set(accounts.map(({ id }) => id)).size).toBe(2);
      expect(accounts.map(({ id }) => id)).not.toContain("a-source-account");
      expect(accounts.map(({ id }) => id)).not.toContain("rehearsal-accounts-1");
      const clients = db.prepare("SELECT accountId FROM clients ORDER BY id").all();
      expect(clients).toEqual(db.prepare("SELECT accountId FROM projects ORDER BY id").all());
      expect(new Set(clients.map(({ accountId }) => accountId))).toEqual(new Set(accounts.map(({ id }) => id)));
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      // Missing parent tables and columns are historical-shape no-ops as well.
      remapIds(db, "missing_table", "id", []);
      remapIds(db, "accounts", "missingColumn", []);
      expect(db.prepare("SELECT id FROM accounts ORDER BY id").all()).toEqual(accounts);
    } finally {
      db.close();
    }
  });

  it("scrubs only orphan references when the parent exists and preserves nulls", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE user (id TEXT PRIMARY KEY);
        CREATE TABLE account_security_revisions (principalId TEXT);
        INSERT INTO user VALUES ('known-principal');
        INSERT INTO account_security_revisions VALUES ('known-principal'), ('source-orphan'), (NULL);
      `);
      scrubDanglingReferences(
        db,
        "user",
        "id",
        [{ table: "account_security_revisions", column: "principalId" }],
        "principal",
      );
      const rows = db.prepare("SELECT principalId FROM account_security_revisions ORDER BY rowid").all();
      expect(rows[0]).toEqual({ principalId: "known-principal" });
      expect(rows[1]?.principalId).toMatch(/^rehearsal-dangling-principal-/);
      expect(rows[2]).toEqual({ principalId: null });
    } finally {
      db.close();
    }
  });

  it("scrubs every non-null reference when the parent is absent", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE account_security_revisions (principalId TEXT);
        INSERT INTO account_security_revisions VALUES ('source-first'), ('source-second'), (NULL);
      `);
      scrubDanglingReferences(
        db,
        "user",
        "id",
        [
          { table: "account_security_revisions", column: "principalId" },
          { table: "missing_table", column: "principalId" },
          { table: "account_security_revisions", column: "missingColumn" },
        ],
        "principal",
      );
      const rows = db.prepare("SELECT principalId FROM account_security_revisions ORDER BY rowid").all();
      expect(rows).toHaveLength(3);
      expect(rows[0]?.principalId).toMatch(/^rehearsal-dangling-principal-/);
      expect(rows[1]?.principalId).toMatch(/^rehearsal-dangling-principal-/);
      expect(rows[0]?.principalId).not.toBe(rows[1]?.principalId);
      expect(rows[2]).toEqual({ principalId: null });
    } finally {
      db.close();
    }
  });
});

describe("rehearsal schema coverage", () => {
  it("classifies every live app and auth column while allowing historical ledger entries", async () => {
    const db = openDb(":memory:");
    try {
      const { auth } = authFromEnv(db, { ...PASSWORD_ENV, CAPACITYLENS_REQUIRE_MFA: "1" });
      await runAuthMigrations(auth!);
      const tables = db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>;
      expect(tables.map(({ name }) => name)).toEqual(
        expect.arrayContaining(["user", "account", "session", "verification", "twoFactor"]),
      );
      const missing: string[] = [];
      for (const { name } of tables) {
        if (!KNOWN_TABLES.has(name)) missing.push(name);
        const columns = db.prepare(`PRAGMA table_info("${name.replaceAll('"', '""')}")`).all() as Array<{
          name: string;
        }>;
        for (const column of columns) {
          if (!KNOWN_COLUMNS[name]?.has(column.name)) missing.push(`${name}.${column.name}`);
        }
      }
      expect(missing).toEqual([]);
    } finally {
      db.close();
    }
  });
});
