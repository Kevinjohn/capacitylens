import { APP_DATA_WRITE_ORDER, SCOPED_WRITE_ORDER } from "@capacitylens/shared/types/entities";
import { TABLE_DEFINITIONS } from "./tables/columns";
export { INTERNAL_CLIENT_UNIQUE_INDEX_SQL, SCHEMA_SQL, SCHEMA_V8_SQL } from "./tables/ddl";
// The single source of truth for the SQL schema and the row<->object mapping. One
// entry per AppData table. `columns` is the exact column order used for INSERT and
// for reading rows back. `json` columns are JSON.stringify'd on write / parsed on
// read; `optional` columns are stored NULL when absent and omitted (not null) when
// read back, so a round-tripped row deep-equals the client's object.

export interface ColumnSpec {
  name: string;
  json?: boolean;
  optional?: boolean;
  /** Preserve SQL NULL as an explicit object value instead of treating it as an omitted optional.
   * Changes what `optional` means for this column: unlike a normal optional column (absent when
   * NULL), the field is always present on read and NULL is a meaningful value in its own right.
   * Retained for decoding historical schema specifications. */
  preserveNull?: boolean;
  /** SQLite storage class; omitted means TEXT. Kept beside the write-column contract so startup
   * can reject a live declaration that no longer matches the values insertRow binds. */
  sqlType?: "INTEGER" | "REAL";
}

export interface TableSpec {
  /** AppData key === REST path segment (e.g. 'timeOff' → /api/timeOff). */
  key: string;
  columns: ColumnSpec[];
}
export function assertUniqueTableColumns(tableKey: string, columns: readonly ColumnSpec[]): void {
  const seen = new Set<string>();
  for (const column of columns) {
    if (seen.has(column.name)) {
      throw new Error(
        `Table ${JSON.stringify(tableKey)} declares column ${JSON.stringify(column.name)} more than once.`,
      );
    }
    seen.add(column.name);
  }
}

for (const table of Object.values(TABLE_DEFINITIONS)) assertUniqueTableColumns(table.key, table.columns);

// Runtime adapters accept untrusted string table names, so expose the checked closed definition
// through a string index while retaining the exact-key completeness check above.
export const TABLES: Record<string, TableSpec> = TABLE_DEFINITIONS;

// Parent-before-child order for creates/updates. Deletes use the reverse so a child
// is always removed before its parent (and the DB's ON DELETE handles any overlap
// with the store's own cascade, which arrives as idempotent deletes).
export const CREATE_ORDER = APP_DATA_WRITE_ORDER;
export const SCOPED_ORDER = SCOPED_WRITE_ORDER;
