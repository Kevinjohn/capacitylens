import type { Db } from "../db";
export interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface SchemaColumnInfo extends ColumnInfo {
  hidden: number;
}

const columns = (db: Db, table: string): ColumnInfo[] =>
  db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfo[];

export const schemaColumns = (db: Db, table: string): SchemaColumnInfo[] =>
  db.prepare(`PRAGMA table_xinfo(${table})`).all() as unknown as SchemaColumnInfo[];

// Exported so controlTables.ts's own PRAGMA table_info(X)-shaped column-presence checks can reuse
// this single definition instead of a second hand-rolled copy.
export const hasColumn = (db: Db, table: string, column: string): boolean =>
  columns(db, table).some((c) => c.name === column);

export const isNotNull = (db: Db, table: string, column: string): boolean =>
  columns(db, table).some((c) => c.name === column && c.notnull === 1);

/** True when a table physically exists in this DB (vs. PRAGMA table_info, which returns an
 *  empty column list for BOTH a missing table and a zero-column one — we need to tell them apart
 *  for the legacy rename below). */
export const tableExists = (db: Db, table: string): boolean =>
  (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).all(table) as unknown[]).length > 0;

export interface AssertTableColumnsInput {
  db: Db;
  table: string;
  expected: readonly ExpectedColumn[];
  /** Names the contract that has been broken. */
  message: string;
}

export interface ExpectedColumn {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

/**
 * Assert that a table's columns are exactly `expected`, in order.
 *
 * The shared body of the boot-time control-table shape assertions (the audit outbox, the ownership
 * transfer workflow table). Those tables sit outside AppData/TABLES, so `schema.ts` cannot cover
 * them and each needs its own check; the comparison itself is the same every time, and a second
 * hand-rolled copy of it is a place where one table's check can quietly drift from another's.
 *
 * `message` names the contract that has been broken rather than the columns that differ: the fault
 * is always "this database is not the one this build was written against", and the operator needs
 * to know which contract, not which column.
 */
export function assertTableColumns({ db, table, expected, message }: AssertTableColumnsInput): void {
  const actual = columns(db, table).map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}
