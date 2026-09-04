import { DatabaseSync } from "node:sqlite";
import { SCHEMA_V8_SQL, TABLES, type ColumnSpec, type TableSpec } from "../tables";
import type { ColumnInfo } from "./introspection";
/**
 * Materialise a historical table contract from its immutable DDL. This deliberately does not
 * consult TABLES: released migrations must not absorb fields added to the live write model later.
 * SQLite does the DDL parsing so the contract stays tied to the exact text checksummed in db.ts.
 */
function tableSpecsFromHistoricalSql(sql: string): Record<string, TableSpec> {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(sql);
    const tableNames = (
      db
        .prepare(
          `
      SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_meta'
       ORDER BY name
    `,
        )
        .all() as Array<{ name: string }>
    ).map(({ name }) => name);

    return Object.fromEntries(
      tableNames.map((table) => {
        const historicalColumns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfo[];
        const versionedColumns = historicalColumns.map((column): ColumnSpec => {
          const sqlType = column.type.toUpperCase();
          if (sqlType !== "TEXT" && sqlType !== "INTEGER" && sqlType !== "REAL") {
            throw new Error(`Unsupported historical column type ${table}.${column.name}: ${column.type}`);
          }
          return {
            name: column.name,
            ...(column.notnull === 0 && column.pk === 0 ? { optional: true } : {}),
            ...(sqlType === "INTEGER" || sqlType === "REAL" ? { sqlType } : {}),
          };
        });
        return [table, { key: table, columns: versionedColumns }];
      }),
    );
  } finally {
    db.close();
  }
}

export const V8_TABLES = tableSpecsFromHistoricalSql(SCHEMA_V8_SQL);
export const V9_TABLES = tableSpecsFromHistoricalSql(`${SCHEMA_V8_SQL}
ALTER TABLE accounts ADD COLUMN internalColourMode TEXT;`);
export const V16_TABLES = tableSpecsFromHistoricalSql(`${SCHEMA_V8_SQL}
ALTER TABLE accounts ADD COLUMN internalColourMode TEXT;
ALTER TABLE accounts ADD COLUMN showInternalProjects TEXT;
ALTER TABLE accounts ADD COLUMN showInternalActivities TEXT;
ALTER TABLE accounts ADD COLUMN inlineActivityCreateEnabled TEXT;`);
// Historical contracts let released migrations validate their own result without accidentally
// requiring columns owned by a later migration.
const V29_ACCOUNTS: TableSpec = {
  ...TABLES.accounts,
  columns: TABLES.accounts.columns.filter(
    (column) => column.name !== "groupResourcesByEngagement" && column.name !== "workingDays",
  ),
};
const V30_ACCOUNTS: TableSpec = {
  ...TABLES.accounts,
  columns: TABLES.accounts.columns.filter((column) => column.name !== "workingDays"),
};
const PRE_V35_ALLOCATIONS: TableSpec = {
  ...TABLES.allocations,
  columns: TABLES.allocations.columns.filter((column) => column.name !== "projectId"),
};
const V31_ALLOCATIONS: TableSpec = {
  ...PRE_V35_ALLOCATIONS,
  columns: PRE_V35_ALLOCATIONS.columns.filter((column) => column.name !== "seriesId"),
};
const V32_TIME_OFF: TableSpec = {
  ...TABLES.timeOff,
  columns: TABLES.timeOff.columns.map((column) => (column.name === "resourceId" ? { name: column.name } : column)),
};
const PRE_V34_TABLES = Object.fromEntries(Object.entries(TABLES).filter(([key]) => key !== "closures")) as Record<
  string,
  TableSpec
>;
PRE_V34_TABLES.allocations = PRE_V35_ALLOCATIONS;
export const V27_TABLES: Record<string, TableSpec> = {
  ...PRE_V34_TABLES,
  accounts: V29_ACCOUNTS,
  allocations: V31_ALLOCATIONS,
  timeOff: V32_TIME_OFF,
  resources: {
    ...TABLES.resources,
    columns: TABLES.resources.columns.filter((column) => column.name !== "halfDays" && column.name !== "engagement"),
  },
};
export const V28_TABLES: Record<string, TableSpec> = {
  ...PRE_V34_TABLES,
  accounts: V29_ACCOUNTS,
  allocations: V31_ALLOCATIONS,
  timeOff: V32_TIME_OFF,
  resources: {
    ...TABLES.resources,
    columns: TABLES.resources.columns.filter((column) => column.name !== "engagement"),
  },
};
export const V29_TABLES: Record<string, TableSpec> = {
  ...PRE_V34_TABLES,
  accounts: V29_ACCOUNTS,
  allocations: V31_ALLOCATIONS,
  timeOff: V32_TIME_OFF,
};
export const V30_TABLES: Record<string, TableSpec> = {
  ...PRE_V34_TABLES,
  accounts: V30_ACCOUNTS,
  allocations: V31_ALLOCATIONS,
  timeOff: V32_TIME_OFF,
};
export const V31_TABLES: Record<string, TableSpec> = {
  ...PRE_V34_TABLES,
  allocations: V31_ALLOCATIONS,
  timeOff: V32_TIME_OFF,
};
export const V32_TABLES: Record<string, TableSpec> = {
  ...PRE_V34_TABLES,
  timeOff: V32_TIME_OFF,
};
export const V33_TABLES: Record<string, TableSpec> = {
  ...PRE_V34_TABLES,
  timeOff: {
    ...TABLES.timeOff,
    columns: TABLES.timeOff.columns.map((column) =>
      column.name === "resourceId" ? { name: column.name, optional: true, preserveNull: true } : column,
    ),
  },
};
export const V34_TABLES: Record<string, TableSpec> = {
  ...TABLES,
  allocations: PRE_V35_ALLOCATIONS,
};
