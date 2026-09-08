import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { anonymise } from "../scripts/rehearse/anonymise";
import { remapIds, scrubDanglingReferences } from "../scripts/rehearse/anonymiseOperations";
import { KNOWN_COLUMNS, KNOWN_TABLES } from "../scripts/rehearse/knownColumns";
import { createAuthFromEnvironment, runAuthMigrations, type Auth } from "./auth";
import { openDb } from "./db";
import { PASSWORD_ENV } from "./testHelpers";

function assertAuth(auth: Auth | null): Auth {
  if (!auth) throw new Error("Password auth fixture was not created.");
  return auth;
}

function assertText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Expected ${label} to be text.`);
  return value;
}

function assertAnonymiseRejects(schema: string, offender: string): void {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT); INSERT INTO accounts VALUES ('source-account', 'Wayne Enterprises');",
    );
    db.exec(schema);
    const accounts = db.prepare("SELECT * FROM accounts").all();
    expect(() => anonymise(db)).toThrow(offender);
    expect(db.prepare("SELECT * FROM accounts").all()).toEqual(accounts);
    assertSecretPreserved(db, offender);
  } finally {
    db.close();
  }
}

function assertSecretPreserved(db: DatabaseSync, offender: string): void {
  if (offender !== "unexpected_secrets") return;
  expect(db.prepare("SELECT value FROM unexpected_secrets").get()).toEqual({ value: "source-secret" });
}

function assertRemapsIds(): void {
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
    remapIds({
      db: db,
      table: "accounts",
      idColumn: "id",
      references: [
        { table: "clients", column: "accountId" },
        { table: "projects", column: "accountId" },
        { table: "missing_table", column: "accountId" },
        { table: "clients", column: "missingColumn" },
      ],
    });
    const accounts = db.prepare("SELECT id FROM accounts ORDER BY id").all();
    expect(accounts).toHaveLength(2);
    expect(new Set(accounts.map(({ id }) => id)).size).toBe(2);
    expect(accounts.map(({ id }) => id)).not.toContain("a-source-account");
    expect(accounts.map(({ id }) => id)).not.toContain("rehearsal-accounts-1");
    const clients = db.prepare("SELECT accountId FROM clients ORDER BY id").all();
    expect(clients).toEqual(db.prepare("SELECT accountId FROM projects ORDER BY id").all());
    expect(new Set(clients.map(({ accountId }) => accountId))).toEqual(new Set(accounts.map(({ id }) => id)));
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    assertHistoricalShapesAreNoOps(db, accounts);
  } finally {
    db.close();
  }
}

function assertHistoricalShapesAreNoOps(db: DatabaseSync, accounts: unknown[]): void {
  remapIds({ db: db, table: "missing_table", idColumn: "id", references: [] });
  remapIds({ db: db, table: "accounts", idColumn: "missingColumn", references: [] });
  expect(db.prepare("SELECT id FROM accounts ORDER BY id").all()).toEqual(accounts);
}

function assertScrubsKnownParent(): void {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE user (id TEXT PRIMARY KEY);
      CREATE TABLE account_security_revisions (principalId TEXT);
      INSERT INTO user VALUES ('known-principal');
      INSERT INTO account_security_revisions VALUES ('known-principal'), ('source-orphan'), (NULL);
    `);
    scrubDanglingReferences({
      db: db,
      parentTable: "user",
      parentColumn: "id",
      references: [{ table: "account_security_revisions", column: "principalId" }],
      label: "principal",
    });
    const rows = db.prepare("SELECT principalId FROM account_security_revisions ORDER BY rowid").all();
    expect(rows[0]).toEqual({ principalId: "known-principal" });
    expect(rows[1]?.principalId).toMatch(/^rehearsal-dangling-principal-/);
    expect(rows[2]).toEqual({ principalId: null });
  } finally {
    db.close();
  }
}

function assertScrubsMissingParent(): void {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE account_security_revisions (principalId TEXT);
      INSERT INTO account_security_revisions VALUES ('source-first'), ('source-second'), (NULL);
    `);
    scrubDanglingReferences({
      db: db,
      parentTable: "user",
      parentColumn: "id",
      references: [
        { table: "account_security_revisions", column: "principalId" },
        { table: "missing_table", column: "principalId" },
        { table: "account_security_revisions", column: "missingColumn" },
      ],
      label: "principal",
    });
    const rows = db.prepare("SELECT principalId FROM account_security_revisions ORDER BY rowid").all();
    expect(rows).toHaveLength(3);
    expect(rows[0]?.principalId).toMatch(/^rehearsal-dangling-principal-/);
    expect(rows[1]?.principalId).toMatch(/^rehearsal-dangling-principal-/);
    expect(rows[0]?.principalId).not.toBe(rows[1]?.principalId);
    expect(rows[2]).toEqual({ principalId: null });
  } finally {
    db.close();
  }
}

function listSchemaTables(db: DatabaseSync): Array<{ name: string }> {
  return db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => ({ name: assertText(row.name, "table name") }));
}

function listMissingSchemaEntries(db: DatabaseSync, tables: Array<{ name: string }>): string[] {
  const missing: string[] = [];
  for (const { name } of tables) {
    if (!KNOWN_TABLES.has(name)) missing.push(name);
    missing.push(...listMissingColumns(db, name));
  }
  return missing;
}

function listMissingColumns(db: DatabaseSync, tableName: string): string[] {
  const knownColumns = Object.hasOwn(KNOWN_COLUMNS, tableName) ? KNOWN_COLUMNS[tableName] : undefined;
  const columns = db
    .prepare(`PRAGMA table_info("${tableName.replaceAll('"', '""')}")`)
    .all()
    .map((row) => assertText(row.name, `${tableName} column name`));
  return columns
    .filter((name) => knownColumns === undefined || !knownColumns.has(name))
    .map((name) => `${tableName}.${name}`);
}

async function assertSchemaCoverage(): Promise<void> {
  const db = openDb(":memory:");
  try {
    const { auth } = createAuthFromEnvironment(db, { ...PASSWORD_ENV, CAPACITYLENS_REQUIRE_MFA: "1" });
    await runAuthMigrations(assertAuth(auth));
    const tables = listSchemaTables(db);
    expect(tables.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["user", "account", "session", "verification", "twoFactor"]),
    );
    expect(listMissingSchemaEntries(db, tables)).toEqual([]);
  } finally {
    db.close();
  }
}

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
  ])("rejects $offender before changing any seeded values", ({ schema, offender }) =>
    assertAnonymiseRejects(schema, offender),
  );

  it("remaps every present reference without colliding with an existing rehearsal id", assertRemapsIds);

  it("scrubs only orphan references when the parent exists and preserves nulls", assertScrubsKnownParent);

  it("scrubs every non-null reference when the parent is absent", assertScrubsMissingParent);
});

describe("rehearsal schema coverage", () => {
  it("classifies every live app and auth column while allowing historical ledger entries", assertSchemaCoverage);
});
