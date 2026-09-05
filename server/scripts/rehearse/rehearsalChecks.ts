import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { DATABASE_MIGRATION_TABLE } from "../../src/db";
import { quoteIdentifier, tableNames, columns, hasTable } from "./sqliteIntrospection";

/** Count rows in every persistent user table for migration-preservation checks. */
export function rowCounts(db: DatabaseSync): Record<string, number> {
  return Object.fromEntries(
    tableNames(db).map((table) => [
      table,
      Number((db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdentifier(table)}`).get() as { n: number }).n),
    ]),
  );
}

function serialisable(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return value.map(serialisable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, serialisable(item)]),
    );
  }
  return value;
}

/** Digest schema, rows and version stamps so rollback scenarios detect more than row-count drift. */
export function databaseDigest(db: DatabaseSync): string {
  const hash = createHash("sha256");
  const version = db.prepare("PRAGMA user_version").get();
  const applicationId = db.prepare("PRAGMA application_id").get();
  hash.update(JSON.stringify(serialisable({ version, applicationId })));
  const schemas = db
    .prepare(`SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`)
    .all();
  hash.update(JSON.stringify(serialisable(schemas)));
  for (const table of tableNames(db)) {
    const orderedColumns = [...columns(db, table)].map(quoteIdentifier);
    const rows = db
      .prepare(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY ${orderedColumns.join(", ")}`)
      .iterate() as Iterable<Record<string, unknown>>;
    hash.update(table);
    for (const row of rows) {
      const encoded = JSON.stringify(serialisable(row));
      hash
        .update(String(Buffer.byteLength(encoded)))
        .update(":")
        .update(encoded);
    }
  }
  return hash.digest("hex");
}

/** Throw when SQLite reports corruption or broken foreign-key relationships. */
export function checkIntegrity(db: DatabaseSync, label: string): void {
  const quick = db.prepare("PRAGMA quick_check").all() as Array<{
    quick_check?: string;
  }>;
  if (quick.length !== 1 || quick[0]?.quick_check !== "ok") throw new Error(`${label}: quick_check failed`);
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length > 0) throw new Error(`${label}: ${foreignKeys.length} foreign-key violation(s)`);
}

/** Exact destructive effects that the current migration chain is expected to have. Calculate
 * these before anonymisation so accidentally severing a migration join cannot turn its expected
 * deletion into a rehearsal-approved no-op. */
export function expectedPostMigrationRowCounts(db: DatabaseSync, fromVersion: number): Record<string, number> {
  const expected: Record<string, number> = {};
  const inviteColumns = hasTable(db, "invites") ? columns(db, "invites") : new Set<string>();
  if (fromVersion < 10 && inviteColumns.has("role") && inviteColumns.has("usedAt")) {
    expected.invites = Number(
      (
        db
          .prepare(
            `
      SELECT COUNT(*) AS n
        FROM invites
       WHERE NOT (role = 'owner' AND usedAt IS NULL)
    `,
          )
          .get() as { n: number }
      ).n,
    );
  }
  const verificationColumns = hasTable(db, "verification") ? columns(db, "verification") : new Set<string>();
  const memberColumns = hasTable(db, "account_members") ? columns(db, "account_members") : new Set<string>();
  if (
    fromVersion < 14 &&
    verificationColumns.has("value") &&
    memberColumns.has("status") &&
    memberColumns.has("userId")
  ) {
    expected.verification = Number(
      (
        db
          .prepare(
            `
      SELECT COUNT(*) AS n
        FROM verification AS ceremony
       WHERE NOT EXISTS (
         SELECT 1
           FROM account_members AS member
          WHERE member.status = 'active'
            AND member.userId = ceremony.value
       )
    `,
          )
          .get() as { n: number }
      ).n,
    );
  }
  return expected;
}

/** Reject row-count changes outside the explicitly expected migration effects. */
export function assertPreserved(
  before: Record<string, number>,
  after: Record<string, number>,
  expectedAfter: Record<string, number>,
): void {
  for (const [table, count] of Object.entries(before)) {
    if (table === "clients" || table === "_meta" || table === DATABASE_MIGRATION_TABLE) continue;
    const target = table === "tasks" ? "activities" : table;
    const expectedCount = expectedAfter[table] ?? count;
    if (after[target] !== expectedCount) {
      throw new Error(
        `happy path changed ${table} row count from ${count} to ${after[target] ?? 0}; ` + `expected ${expectedCount}`,
      );
    }
  }
  if ((after.clients ?? 0) < (after.accounts ?? 0)) {
    throw new Error("happy path did not leave every account with an Internal client");
  }
}
