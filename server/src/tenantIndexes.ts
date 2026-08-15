import type { Db } from "./db";

/** Immutable database-v21 index manifest. Every AppData table except accounts is tenant-scoped. */
export const TENANT_ENTITY_ACCOUNT_INDEXES_V21 = [
  { table: "clients", index: "idx_clients_accountId" },
  { table: "disciplines", index: "idx_disciplines_accountId" },
  { table: "projects", index: "idx_projects_accountId" },
  { table: "phases", index: "idx_phases_accountId" },
  { table: "resources", index: "idx_resources_accountId" },
  { table: "activities", index: "idx_activities_accountId" },
  { table: "allocations", index: "idx_allocations_accountId" },
  { table: "timeOff", index: "idx_timeOff_accountId" },
] as const;

export const TENANT_ENTITY_INDEXES_V21_SQL = TENANT_ENTITY_ACCOUNT_INDEXES_V21.map(
  ({ table, index }) => `CREATE INDEX IF NOT EXISTS ${index} ON ${table}(accountId);`,
).join("\n");

/** Immutable database-v23 indexes for every non-account foreign-key child lookup. SQLite does not
 * create these automatically, but uses them to avoid scanning a child table during parent deletes. */
export const FOREIGN_KEY_CHILD_INDEXES_V23 = [
  { table: "projects", column: "clientId", index: "idx_projects_clientId" },
  { table: "phases", column: "projectId", index: "idx_phases_projectId" },
  { table: "resources", column: "disciplineId", index: "idx_resources_disciplineId" },
  { table: "resources", column: "projectId", index: "idx_resources_projectId" },
  { table: "activities", column: "projectId", index: "idx_activities_projectId" },
  { table: "activities", column: "phaseId", index: "idx_activities_phaseId" },
  { table: "allocations", column: "resourceId", index: "idx_allocations_resourceId" },
  { table: "allocations", column: "activityId", index: "idx_allocations_activityId" },
  { table: "timeOff", column: "resourceId", index: "idx_timeOff_resourceId" },
] as const;

export const FOREIGN_KEY_CHILD_INDEXES_V23_SQL = FOREIGN_KEY_CHILD_INDEXES_V23.map(
  ({ table, column, index }) => `CREATE INDEX IF NOT EXISTS ${index} ON ${table}(${column});`,
).join("\n");

export const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

/** Shared shape check behind assertTenantAccountIndexesV21 and assertTenantEntityIndexesCurrent's
 *  foreign-key loop: both verify a single non-unique, non-partial, ASC/BINARY, table-created index
 *  on exactly one named column. The two call sites keep their own byte-identical error message text
 *  (`message` is caller-supplied) — only the PRAGMA-reading/shape-check logic is shared. */
function assertSingleColumnIndex(db: Db, table: string, index: string, column: string, message: string): void {
  const listed = (
    db.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all() as Array<{
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }>
  ).find((candidate) => candidate.name === index);
  const keys = (
    db.prepare(`PRAGMA index_xinfo(${quoteIdentifier(index)})`).all() as Array<{
      name: string | null;
      desc: number;
      coll: string;
      key: number;
    }>
  ).filter((candidate) => candidate.key === 1);
  if (
    !listed ||
    listed.unique !== 0 ||
    listed.origin !== "c" ||
    listed.partial !== 0 ||
    keys.length !== 1 ||
    keys[0]?.name !== column ||
    keys[0]?.desc !== 0 ||
    keys[0]?.coll !== "BINARY"
  ) {
    throw new Error(message);
  }
}

/** Verify the immutable v21 subset while replaying that migration. */
export function assertTenantAccountIndexesV21(db: Db): void {
  for (const { table, index } of TENANT_ENTITY_ACCOUNT_INDEXES_V21) {
    assertSingleColumnIndex(
      db,
      table,
      index,
      "accountId",
      `Tenant entity index ${index} does not match ${table}(accountId).`,
    );
  }
}

/** Verify every current tenant-slice and foreign-key child index. */
export function assertTenantEntityIndexesCurrent(db: Db): void {
  assertTenantAccountIndexesV21(db);
  for (const { table, column, index } of FOREIGN_KEY_CHILD_INDEXES_V23) {
    assertSingleColumnIndex(
      db,
      table,
      index,
      column,
      `Foreign-key child index ${index} does not match ${table}(${column}).`,
    );
  }
}
