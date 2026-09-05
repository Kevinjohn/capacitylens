/** Column encoding and storage metadata shared by schema checks and row codecs. */
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

/** An ordered column specification for a table exposed through the generic entity API. */
export interface TableSpec {
  /** AppData key === REST path segment (e.g. 'timeOff' → /api/timeOff). */
  key: string;
  columns: ColumnSpec[];
}
