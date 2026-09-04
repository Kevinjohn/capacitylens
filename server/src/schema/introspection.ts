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
