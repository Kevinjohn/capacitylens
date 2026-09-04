import type { Db } from "../db";
import { DATABASE_MIGRATION_TABLE } from "./constants";
import { DATABASE_MIGRATIONS } from "./migrations/index";
import { isSupersededMigrationChecksum } from "./migrationLedger";
function migrationHistoryExists(db: Db): boolean {
  return (
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(DATABASE_MIGRATION_TABLE) !==
    undefined
  );
}

export function assertMigrationHistoryTable(db: Db): void {
  const expected = new Map<string, { type: string; required: boolean }>([
    ["version", { type: "INTEGER", required: true }],
    ["name", { type: "TEXT", required: true }],
    ["checksum", { type: "TEXT", required: true }],
    ["appliedAt", { type: "TEXT", required: true }],
  ]);
  const columns = db.prepare(`PRAGMA table_info(${DATABASE_MIGRATION_TABLE})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>;
  const problems: string[] = [];
  for (const column of columns) {
    const wanted = expected.get(column.name);
    if (!wanted) {
      problems.push(`unexpected column ${column.name}`);
      continue;
    }
    if (column.type.toUpperCase() !== wanted.type) problems.push(`${column.name} has type ${column.type}`);
    if ((column.notnull === 1) !== wanted.required) problems.push(`${column.name} nullability mismatch`);
    if (column.name === "version" && column.pk !== 1) problems.push("version is not the primary key");
  }
  for (const name of expected.keys()) {
    if (!columns.some((column) => column.name === name)) problems.push(`missing column ${name}`);
  }
  if (problems.length > 0) {
    throw new Error(`Database migration history table is invalid — ${problems.join("; ")}.`);
  }
}

/** Validate the database-side audit trail before planning any writes. Legacy v0-v7 files have no
 * history yet; v8 creates the table and its baseline row atomically with the schema/version stamp. */
export function assertMigrationHistory(db: Db, databaseVersion: number): void {
  const exists = migrationHistoryExists(db);
  const expected = DATABASE_MIGRATIONS.filter((migration) => migration.version <= databaseVersion);
  if (!exists) {
    if (expected.length > 0) {
      throw new Error(
        `Database schema version ${databaseVersion} is missing its ${DATABASE_MIGRATION_TABLE} audit trail.`,
      );
    }
    return;
  }

  assertMigrationHistoryTable(db);
  const rows = db
    .prepare(`SELECT version, name, checksum, appliedAt FROM ${DATABASE_MIGRATION_TABLE} ORDER BY version`)
    .all() as Array<{
    version: number;
    name: string;
    checksum: string;
    appliedAt: string;
  }>;
  if (rows.length !== expected.length) {
    throw new Error(
      `Database migration history has ${rows.length} row(s), expected ${expected.length} for schema version ${databaseVersion}.`,
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    const migration = expected[index];
    const row = rows[index];
    if (row.version !== migration.version) {
      throw new Error(`Database migration history is missing or out of order at version ${migration.version}.`);
    }
    if (row.name !== migration.name) {
      throw new Error(`Database migration v${migration.version} name does not match this build.`);
    }
    // Accept the current checksum OR one explicitly superseded prior checksum for this version (the
    // one-time alpha-line amendment allow-list). Any OTHER value is genuine drift and refuses boot.
    if (row.checksum !== migration.checksum && !isSupersededMigrationChecksum(migration.version, row.checksum)) {
      throw new Error(`Database migration v${migration.version} checksum does not match this build.`);
    }
    if (!row.appliedAt) throw new Error(`Database migration v${migration.version} has no applied timestamp.`);
  }
}
