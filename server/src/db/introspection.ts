import { TABLES, type TableSpec } from "../tables";
import type { Db } from "../db";
// `table` is interpolated DIRECTLY into the SQL strings below (SQL can't parameterise an
// identifier), so it MUST be a vetted key of TABLES — this is the SQL-injection safety boundary.
// Every route already gates the table name through isKnownTable before reaching these primitives;
// this assertion is defence-in-depth (a future caller can't turn an unchecked string into an
// injection point) and turns a cryptic "cannot read properties of undefined" into a clear message.
// One own-property lookup — `Object.hasOwn`, not `in`, so a prototype key like "constructor" can't
// masquerade as a table.
export function assertKnownTable(table: string): void {
  if (!Object.hasOwn(TABLES, table)) {
    throw new Error(`Unknown table "${table}" — not a known entity table (SQL-identifier safety guard).`);
  }
}

/** assertKnownTable + TABLES-lookup prelude shared by every primitive that needs the table's spec
 *  (insertRowRaw / upsertRow / getRow). deleteRow doesn't need the spec, so it keeps calling
 *  assertKnownTable directly instead of discarding this return value. */
export function resolveTable(table: string): TableSpec {
  assertKnownTable(table);
  return TABLES[table];
}

export const pragmaNumber = (db: Db, pragma: "user_version" | "application_id"): number =>
  Number((db.prepare(`PRAGMA ${pragma}`).get() as Record<string, number | undefined>)[pragma] ?? 0);

export const userTables = (db: Db): string[] =>
  (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);

export const tableHasColumns = (db: Db, table: string, required: readonly string[]): boolean => {
  const columns = new Set(
    (
      db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
        name: string;
      }>
    ).map(({ name }) => name),
  );
  return required.every((column) => columns.has(column));
};

export const tableExists = (db: Db, table: string): boolean =>
  db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !== undefined;

const tableHasForeignKey = (db: Db, table: string, from: string, targetTable: string, targetColumn = "id"): boolean =>
  (
    db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Array<{
      from: string;
      table: string;
      to: string;
    }>
  ).some((key) => key.from === from && key.table === targetTable && key.to === targetColumn);

/** application_id predates the retained v7 fixtures, so legacy recognition must be structural.
 * Require the distinctive account→client→project→work chain plus allocation ownership rather
 * than accepting any second table whose name happens to overlap the domain model. The identifiers
 * below are fixed source constants, never caller input. */
export function hasLegacyCapacityLensShape(db: Db, tables: readonly string[]): boolean {
  const tableSet = new Set(tables);
  const workTable = tableSet.has("activities") ? "activities" : tableSet.has("tasks") ? "tasks" : null;
  if (!workTable || !["accounts", "clients", "projects", "allocations"].every((table) => tableSet.has(table)))
    return false;

  const allocationWorkColumn = workTable === "activities" ? "activityId" : "taskId";
  return (
    tableHasColumns(db, "accounts", ["id", "name", "createdAt", "updatedAt"]) &&
    tableHasColumns(db, "clients", ["id", "accountId", "name"]) &&
    tableHasColumns(db, "projects", ["id", "accountId", "clientId"]) &&
    tableHasColumns(db, workTable, ["id", "accountId", "name", "projectId"]) &&
    tableHasColumns(db, "allocations", ["id", "accountId", "resourceId", allocationWorkColumn]) &&
    tableHasForeignKey(db, "clients", "accountId", "accounts") &&
    tableHasForeignKey(db, "projects", "accountId", "accounts") &&
    tableHasForeignKey(db, "projects", "clientId", "clients") &&
    tableHasForeignKey(db, workTable, "accountId", "accounts") &&
    tableHasForeignKey(db, workTable, "projectId", "projects") &&
    tableHasForeignKey(db, "allocations", "accountId", "accounts")
  );
}
