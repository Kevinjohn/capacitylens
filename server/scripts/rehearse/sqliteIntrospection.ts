import type { DatabaseSync } from "node:sqlite";

/** Quote a SQLite identifier, including embedded double quotes. */
export const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

/** List persistent user tables in stable name order, excluding SQLite internals. */
export const tableNames = (db: DatabaseSync): string[] =>
  (
    db
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);

/** Read the column names of a present or historical SQLite table. */
export const columns = (db: DatabaseSync, table: string): Set<string> =>
  new Set(
    (db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );

/** Check whether a persistent user table exists in this snapshot. */
export const hasTable = (db: DatabaseSync, table: string): boolean => tableNames(db).includes(table);
