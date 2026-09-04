import type { Db } from "../db";
import { INTERNAL_CLIENT_UNIQUE_INDEX_SQL, type TableSpec } from "../tables";
import { V32_TABLES } from "./historicalSpecs";
import { hasColumn, schemaColumns } from "./introspection";
const normalizeSchemaObjectSql = (sql: string): string =>
  sql
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bIF NOT EXISTS\b\s*/i, "")
    .replace(/;$/, "");

const expectedInternalClientIndexSql = normalizeSchemaObjectSql(INTERNAL_CLIENT_UNIQUE_INDEX_SQL);
/**
 * Fail loudly if the live DB has drifted from the current spec in a way migrateSchema can't (or
 * won't) silently repair. These checks are no-ops on any fresh / current / already-migrated DB —
 * they exist only to turn a developer mistake or physical drift into one clear,
 * early, column-naming startup error instead of a confusing runtime symptom much later:
 *
 *  (1) MISSING COLUMN. migrateSchema auto-adds missing OPTIONAL columns, but SQLite can't
 *      ALTER-ADD a NOT NULL column to a table that already has rows, so a future REQUIRED column
 *      added to an existing on-disk DB can't be migrated automatically — it needs an explicit
 *      rebuild step (the way activities.projectId got one). Otherwise the drift is SILENT: a missing
 *      required column doesn't even throw on read (fromRow yields undefined) and only surfaces as
 *      a cryptic "no column named X" on the first write that names it.
 *
 *  (2) COLUMN CONTRACT. A column's optional? flag (object-level, in TABLES) and its
 *      NULL/NOT NULL in SCHEMA_SQL (DB-level) are two hand-maintained sources of truth; nothing
 *      else checks they still agree. A drift is a real bug: a column marked optional but left
 *      NOT NULL rejects a legitimately-omitted field (confusing 400), and a required column left
 *      nullable lets a NULL read back as undefined for a field the model treats as always-present.
 *      The `id` PRIMARY KEY is exempt — PRAGMA table_info reports notnull=0 for a TEXT PK
 *      (a long-standing SQLite quirk), so it would otherwise look like a false mismatch. Declared
 *      storage types and the id-only primary key are checked from the same TABLES write contract.
 *
 *  (3) WRITE-BREAKING EXTENSIONS. A nullable or defaulted extension column is forward-compatible
 *      with our explicit INSERT column list and remains allowed. An unexpected required/no-default
 *      column, CHECK/UNIQUE constraint, trigger, STRICT or WITHOUT ROWID table option can reject an
 *      otherwise valid TABLES row, so startup refuses that unknown shape before accepting traffic.
 */
export function assertSchemaVersion(
  db: Db,
  tableSpecs: Record<string, TableSpec>,
  allowCompatibleExtensions: boolean,
): void {
  const missing: string[] = [];
  const nullabilityProblems: string[] = [];
  const typeProblems: string[] = [];
  const primaryKeyProblems: string[] = [];
  const unexpectedColumns: string[] = [];
  const unexpectedRequired: string[] = [];
  const constraintProblems: string[] = [];
  const tableOptions = new Map(
    (
      db.prepare("PRAGMA table_list").all() as Array<{
        schema: string;
        name: string;
        type: string;
        wr: number;
        strict: number;
      }>
    )
      .filter((table) => table.schema === "main")
      .map((table) => [table.name, table]),
  );
  for (const [table, spec] of Object.entries(tableSpecs)) {
    const liveColumns = schemaColumns(db, table);
    const live = new Map(liveColumns.map((column) => [column.name, column]));
    const includedNames = new Set(spec.columns.map((column) => column.name));
    for (const col of spec.columns) {
      if (!live.has(col.name)) {
        missing.push(`${table}.${col.name}`);
        continue;
      }
      const liveColumn = live.get(col.name)!;
      if (liveColumn.hidden !== 0) {
        constraintProblems.push(`${table}.${col.name} is unexpectedly generated or hidden`);
      }
      const expectedType = col.sqlType ?? "TEXT";
      if (liveColumn.type.toUpperCase() !== expectedType) {
        typeProblems.push(`${table}.${col.name} (spec ${expectedType}, DB ${liveColumn.type || "untyped"})`);
      }
      const expectedPk = col.name === "id" ? 1 : 0;
      if (liveColumn.pk !== expectedPk) {
        primaryKeyProblems.push(`${table}.${col.name} (spec PK ${expectedPk}, DB PK ${liveColumn.pk})`);
      }
      if (col.name === "id") continue; // TEXT PRIMARY KEY: PRAGMA reports notnull=0 on older DDL
      const liveNotNull = liveColumn.notnull === 1;
      const specNotNull = !col.optional;
      // Historical migrations may be replayed in tests or an idempotent recovery against the
      // already-widened v33 shape. Nullable resourceId is forward-compatible with every personal
      // v8-v32 row; the current TABLES assertion still requires it because its spec is optional.
      const compatibleV33Widening =
        tableSpecs === V32_TABLES && table === "timeOff" && col.name === "resourceId" && specNotNull && !liveNotNull;
      if (liveNotNull !== specNotNull && !compatibleV33Widening) {
        nullabilityProblems.push(
          `${table}.${col.name} (spec ${specNotNull ? "required" : "optional"}, ` +
            `DB ${liveNotNull ? "NOT NULL" : "nullable"})`,
        );
      }
    }
    for (const column of liveColumns) {
      if (includedNames.has(column.name)) continue;
      if (!allowCompatibleExtensions) {
        unexpectedColumns.push(`${table}.${column.name}`);
      } else if (column.notnull === 1 && column.dflt_value === null) {
        unexpectedRequired.push(`${table}.${column.name}`);
      }
      if (column.pk > 0) {
        primaryKeyProblems.push(`${table}.${column.name} is an unexpected primary-key column`);
      }
    }

    const tableInfo = tableOptions.get(table);
    if (tableInfo && (tableInfo.type !== "table" || tableInfo.wr !== 0 || tableInfo.strict !== 0)) {
      constraintProblems.push(
        `${table} has unsupported table options (type ${tableInfo.type}, ` +
          `WITHOUT ROWID ${tableInfo.wr}, STRICT ${tableInfo.strict})`,
      );
    }
    const tableSql =
      (
        db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as
          { sql: string | null } | undefined
      )?.sql ?? "";
    if (/\bCHECK\s*\(/i.test(tableSql)) constraintProblems.push(`${table} has an unexpected CHECK constraint`);

    const expectedUniqueIndexes =
      table === "clients"
        ? new Map([["clients_one_builtin_per_account", expectedInternalClientIndexSql]])
        : new Map<string, string>();
    const actualUniqueIndexes = (
      db.prepare(`PRAGMA index_list(${table})`).all() as Array<{
        name: string;
        unique: number;
        origin: string;
      }>
    ).filter((index) => index.unique === 1 && index.origin !== "pk");
    for (const index of actualUniqueIndexes) {
      const expectedSql = expectedUniqueIndexes.get(index.name);
      const actualSql = (
        db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`).get(index.name) as
          { sql: string | null } | undefined
      )?.sql;
      if (!expectedSql || !actualSql || normalizeSchemaObjectSql(actualSql) !== expectedSql) {
        constraintProblems.push(`${table}.${index.name} is an unexpected or invalid UNIQUE constraint`);
      }
      expectedUniqueIndexes.delete(index.name);
    }
    for (const name of expectedUniqueIndexes.keys()) {
      constraintProblems.push(`${table}.${name} expected UNIQUE constraint is missing`);
    }

    const unexpectedTriggers = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?`).all(table) as Array<{
        name: string;
      }>
    ).filter(({ name }) => !name.startsWith("capacitylens_tenant_"));
    for (const trigger of unexpectedTriggers) {
      constraintProblems.push(`${table}.${trigger.name} is an unexpected trigger`);
    }
  }
  const problems: string[] = [];
  const expectedForeignKeys: Record<string, Array<[string, string, string, string]>> = {
    clients: [["accountId", "accounts", "id", "CASCADE"]],
    disciplines: [["accountId", "accounts", "id", "CASCADE"]],
    projects: [
      ["clientId", "clients", "id", "CASCADE"],
      ["accountId", "accounts", "id", "CASCADE"],
    ],
    phases: [
      ["projectId", "projects", "id", "CASCADE"],
      ["accountId", "accounts", "id", "CASCADE"],
    ],
    resources: [
      ["projectId", "projects", "id", "SET NULL"],
      ["disciplineId", "disciplines", "id", "SET NULL"],
      ["accountId", "accounts", "id", "CASCADE"],
    ],
    activities: [
      ["phaseId", "phases", "id", "SET NULL"],
      ["projectId", "projects", "id", "CASCADE"],
      ["accountId", "accounts", "id", "CASCADE"],
    ],
    allocations: [
      ...(tableSpecs.allocations.columns.some((column) => column.name === "projectId") ||
      (allowCompatibleExtensions && hasColumn(db, "allocations", "projectId"))
        ? [["projectId", "projects", "id", "SET NULL"] as [string, string, string, string]]
        : []),
      ["activityId", "activities", "id", "CASCADE"],
      ["resourceId", "resources", "id", "CASCADE"],
      ["accountId", "accounts", "id", "CASCADE"],
    ],
    timeOff: [
      ["resourceId", "resources", "id", "CASCADE"],
      ["accountId", "accounts", "id", "CASCADE"],
    ],
    ...(tableSpecs.closures ? { closures: [["accountId", "accounts", "id", "CASCADE"]] } : {}),
  };
  const foreignKeyProblems: string[] = [];
  for (const [table, expected] of Object.entries(expectedForeignKeys)) {
    const actual = (
      db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
        from: string;
        table: string;
        to: string;
        on_delete: string;
      }>
    ).map((fk) => [fk.from, fk.table, fk.to, fk.on_delete] as [string, string, string, string]);
    for (const wanted of expected) {
      if (!actual.some((got) => got.every((value, i) => value === wanted[i]))) {
        foreignKeyProblems.push(`${table}.${wanted[0]} -> ${wanted[1]}.${wanted[2]} ON DELETE ${wanted[3]}`);
      }
    }
    if (actual.length !== expected.length) foreignKeyProblems.push(`${table} has unexpected foreign-key count`);
  }
  if (missing.length > 0) {
    problems.push(
      `missing column(s): ${missing.join(", ")} — migrateSchema auto-adds optional columns, but a ` +
        `new REQUIRED (NOT NULL) column needs an explicit migration step (a table rebuild, like ` +
        `rebuildActivitiesTable) before this DB can open`,
    );
  }
  if (nullabilityProblems.length > 0) {
    problems.push(
      `nullability mismatch: ${nullabilityProblems.join("; ")} — the spec's optional? flag and SCHEMA_SQL's ` +
        `NOT NULL have drifted; reconcile them (a NOT NULL change to an existing table needs a rebuild)`,
    );
  }
  if (typeProblems.length > 0) problems.push(`declared-type mismatch: ${typeProblems.join("; ")}`);
  if (primaryKeyProblems.length > 0) problems.push(`primary-key mismatch: ${primaryKeyProblems.join("; ")}`);
  if (unexpectedColumns.length > 0) {
    problems.push(
      `unexpected versioned column(s): ${unexpectedColumns.join(", ")} — a released migration ` +
        `must not include columns owned by a later schema version`,
    );
  }
  if (unexpectedRequired.length > 0) {
    problems.push(
      `unexpected required column(s): ${unexpectedRequired.join(", ")} — TABLES inserts cannot ` +
        `supply unknown NOT NULL columns without defaults`,
    );
  }
  if (constraintProblems.length > 0) {
    problems.push(`unexpected write constraint(s): ${constraintProblems.join("; ")}`);
  }
  if (foreignKeyProblems.length > 0) {
    problems.push(`foreign-key mismatch: ${foreignKeyProblems.join("; ")}`);
  }
  if (problems.length > 0) {
    throw new Error(`DB schema does not match the current model — ${problems.join(". ")}.`);
  }
}
