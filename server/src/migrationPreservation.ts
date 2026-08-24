import type { DatabaseSync } from "node:sqlite";
import { DATABASE_MIGRATION_TABLE } from "./db";
import { quoteIdentifier } from "./tenantIndexes";

type Cell = string | number | bigint | null | Uint8Array;
type SnapshotRow = Record<string, Cell>;
interface SnapshotTable {
  primaryKey: string[];
  rows: SnapshotRow[];
}
export type MigrationValueSnapshot = Record<string, SnapshotTable>;

const EXCLUDED_TABLES = new Set(["_meta", DATABASE_MIGRATION_TABLE]);

/** Capture every value in every non-ledger table, including auth and application control rows. */
export function captureMigrationValues(db: DatabaseSync): MigrationValueSnapshot {
  const names = (
    db
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as Array<{ name: string }>
  ).map(({ name }) => name);
  return Object.fromEntries(
    names
      .filter((name) => !EXCLUDED_TABLES.has(name))
      .map((name) => {
        const info = db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all() as Array<{
          name: string;
          pk: number;
        }>;
        const primaryKey = info
          .filter(({ pk }) => pk > 0)
          .sort((a, b) => a.pk - b.pk)
          .map(({ name: column }) => column);
        if (primaryKey.length === 0) throw new Error(`migration snapshot cannot identify rows in ${name}`);
        const order = primaryKey.map(quoteIdentifier).join(", ");
        const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(name)} ORDER BY ${order}`).all() as SnapshotRow[];
        return [name, { primaryKey, rows }];
      }),
  );
}

const canonicalTableName = (name: string) => (name === "tasks" ? "activities" : name);
const canonicalColumnName = (name: string) => (name === "taskId" ? "activityId" : name);
const canonicalCell = (value: Cell): string => {
  if (typeof value === "bigint") return `bigint:${value}`;
  if (value instanceof Uint8Array) return `blob:${Buffer.from(value).toString("base64")}`;
  return JSON.stringify(value);
};

function canonicalTables(snapshot: MigrationValueSnapshot): MigrationValueSnapshot {
  return Object.fromEntries(
    Object.entries(snapshot).map(([sourceName, table]) => {
      const name = canonicalTableName(sourceName);
      return [
        name,
        {
          primaryKey: table.primaryKey.map(canonicalColumnName),
          rows: table.rows.map((row) =>
            Object.fromEntries(Object.entries(row).map(([column, value]) => [canonicalColumnName(column), value])),
          ),
        },
      ];
    }),
  );
}

const rowKey = (row: SnapshotRow, primaryKey: string[]): string =>
  primaryKey.map((column) => `${column}=${canonicalCell(row[column] ?? null)}`).join(",");

function activeMemberPrincipals(snapshot: MigrationValueSnapshot): Set<string> {
  return new Set(
    (snapshot.account_members?.rows ?? []).filter((row) => row.status === "active").map((row) => String(row.userId)),
  );
}

function foldedInternalClientIds(snapshot: MigrationValueSnapshot, fromVersion: number): Map<string, string> {
  const folded = new Map<string, string>();
  if (fromVersion >= 8) return folded;
  const byAccount = new Map<string, SnapshotRow[]>();
  for (const row of snapshot.clients?.rows ?? []) {
    if (row.builtin !== "true") continue;
    const accountId = String(row.accountId);
    byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), row]);
  }
  for (const [accountId, rows] of byAccount) {
    rows.sort((a, b) => {
      const generatedOrder = Number(b.id === `internal:${accountId}`) - Number(a.id === `internal:${accountId}`);
      if (generatedOrder !== 0) return generatedOrder;
      return String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id));
    });
    const retainedId = String(rows[0]?.id);
    for (const duplicate of rows.slice(1)) folded.set(String(duplicate.id), retainedId);
  }
  return folded;
}

function approvedDeletion(
  table: string,
  row: SnapshotRow,
  fromVersion: number,
  activeMembers: ReadonlySet<string>,
  foldedInternalClients: ReadonlyMap<string, string>,
): boolean {
  if (table === "invites" && fromVersion < 10) return row.role === "owner" && row.usedAt === null;
  if (table === "verification" && fromVersion < 14) return activeMembers.has(String(row.value));
  if (table === "clients" && fromVersion < 8) return foldedInternalClients.has(String(row.id));
  return false;
}

function approvedAddition(table: string, row: SnapshotRow, fromVersion: number): boolean {
  return (
    table === "clients" &&
    fromVersion < 8 &&
    row.builtin === "true" &&
    row.name === "Internal" &&
    typeof row.accountId === "string"
  );
}

/** Column REMOVALS the migration chain deliberately makes. Every entry needs a version-scoped,
 * reviewed justification — an empty list means no populated column may ever disappear unexamined.
 * Renames are modelled as removal+addition and must be approved on the removal side too. */
function approvedColumnRemoval(): boolean {
  // Intentionally empty: no populated column removal is classified yet. Future migrations that
  // deliberately drop a populated column must add a version-scoped, reviewed entry here.
  return false;
}

function approvedCellChange(
  table: string,
  column: string,
  before: SnapshotRow,
  after: SnapshotRow,
  fromVersion: number,
  foldedInternalClients: ReadonlyMap<string, string>,
): boolean {
  if (table === "accounts" && column === "color" && fromVersion < 13) return true;
  if (table === "account_members" && column === "role" && fromVersion < 12) return true;
  if (
    table === "clients" &&
    fromVersion < 8 &&
    before.builtin === "true" &&
    ["name", "color", "builtin"].includes(column)
  )
    return true;
  if (
    table === "projects" &&
    column === "clientId" &&
    fromVersion < 8 &&
    foldedInternalClients.get(String(before.clientId)) === String(after.clientId)
  )
    return true;
  if (
    table === "clients" &&
    fromVersion < 22 &&
    (before.builtin === "true" || after.builtin === "true") &&
    ["archivedAt", "deletedAt", "updatedAt"].includes(column)
  )
    return true;
  return false;
}

/**
 * Compare every pre-existing row/column after applying the migration chain's explicit historical
 * repairs. New schema columns/tables have no pre-migration value to preserve; every common value
 * and relationship must otherwise remain byte-for-byte equivalent.
 */
export function assertMigrationValuesPreserved(
  beforeSnapshot: MigrationValueSnapshot,
  afterSnapshot: MigrationValueSnapshot,
  fromVersion: number,
): void {
  const before = canonicalTables(beforeSnapshot);
  const after = canonicalTables(afterSnapshot);
  const activeMembers = activeMemberPrincipals(before);
  const foldedInternalClients = foldedInternalClientIds(before, fromVersion);
  for (const [tableName, beforeTable] of Object.entries(before)) {
    const afterTable = after[tableName];
    if (!afterTable) throw new Error(`migration removed table ${tableName}`);
    const afterByKey = new Map(afterTable.rows.map((row) => [rowKey(row, beforeTable.primaryKey), row]));
    const beforeKeys = new Set<string>();
    for (const beforeRow of beforeTable.rows) {
      const key = rowKey(beforeRow, beforeTable.primaryKey);
      beforeKeys.add(key);
      const afterRow = afterByKey.get(key);
      if (!afterRow) {
        if (approvedDeletion(tableName, beforeRow, fromVersion, activeMembers, foldedInternalClients)) continue;
        throw new Error(`migration removed unapproved ${tableName} row ${key}`);
      }
      for (const [column, beforeValue] of Object.entries(beforeRow)) {
        if (!(column in afterRow)) {
          // The migration DROPPED this column. A populated value silently disappearing is exactly
          // the data loss this oracle exists to catch (review finding DBR-0003): refuse it unless
          // the value carried nothing or the removal is explicitly classified below.
          const hadValue = beforeValue !== undefined && beforeValue !== null && String(beforeValue) !== "";
          if (!hadValue || approvedColumnRemoval()) continue;
          throw new Error(
            `migration removed unapproved ${tableName}.${column} in row ${key}: ` +
              `populated value ${canonicalCell(beforeValue)} would be lost`,
          );
        }
        const afterValue = afterRow[column];
        if (canonicalCell(beforeValue) === canonicalCell(afterValue)) continue;
        if (approvedCellChange(tableName, column, beforeRow, afterRow, fromVersion, foldedInternalClients)) continue;
        throw new Error(
          `migration changed unapproved ${tableName}.${column} in row ${key}: ` +
            `${canonicalCell(beforeValue)} → ${canonicalCell(afterValue)}`,
        );
      }
    }
    for (const afterRow of afterTable.rows) {
      const key = rowKey(afterRow, beforeTable.primaryKey);
      if (!beforeKeys.has(key) && !approvedAddition(tableName, afterRow, fromVersion)) {
        throw new Error(`migration added unapproved ${tableName} row ${key}`);
      }
    }
  }
}
