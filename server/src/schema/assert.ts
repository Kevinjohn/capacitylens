import type { Db } from "../db";
import { INTERNAL_CLIENT_UNIQUE_INDEX_SQL } from "../tables";
import type { ColumnSpec, TableSpec } from "../tables";
import { V32_TABLES } from "./historicalSpecs";
import { hasColumn, schemaColumns } from "./introspection";
const normalizeSchemaObjectSql = (sql: string): string =>
  sql
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bIF NOT EXISTS\b\s*/i, "")
    .replace(/;$/, "");

const expectedInternalClientIndexSql = normalizeSchemaObjectSql(INTERNAL_CLIENT_UNIQUE_INDEX_SQL);

interface SchemaProblems {
  missing: string[];
  nullability: string[];
  types: string[];
  primaryKeys: string[];
  unexpectedColumns: string[];
  unexpectedRequired: string[];
  constraints: string[];
  foreignKeys: string[];
}

interface InspectTableInput {
  db: Db;
  table: string;
  spec: TableSpec;
  tableSpecs: Record<string, TableSpec>;
  allowCompatibleExtensions: boolean;
  problems: SchemaProblems;
}

interface TableOption {
  type: string;
  wr: number;
  strict: number;
}

interface InspectForeignKeysInput {
  db: Db;
  tableSpecs: Record<string, TableSpec>;
  allowCompatibleExtensions: boolean;
  problems: string[];
}

interface InspectTableConstraintsInput {
  db: Db;
  table: string;
  tableOption?: TableOption;
  problems: string[];
}

const createSchemaProblems = (): SchemaProblems => ({
  missing: [],
  nullability: [],
  types: [],
  primaryKeys: [],
  unexpectedColumns: [],
  unexpectedRequired: [],
  constraints: [],
  foreignKeys: [],
});

type LiveColumn = ReturnType<typeof schemaColumns>[number];

interface InspectColumnInput extends Omit<InspectTableInput, "db" | "allowCompatibleExtensions" | "spec"> {
  liveColumn: LiveColumn | undefined;
  column: ColumnSpec;
}

function inspectColumn({ table, tableSpecs, problems, liveColumn, column }: InspectColumnInput): void {
  if (!liveColumn) {
    problems.missing.push(`${table}.${column.name}`);
    return;
  }
  inspectColumnShape({ table, column, liveColumn, problems });
  if (column.name === "id") return;
  inspectColumnNullability({ table, tableSpecs, problems, liveColumn, column });
}

function inspectColumnShape({
  table,
  column,
  liveColumn,
  problems,
}: Omit<InspectColumnInput, "tableSpecs" | "liveColumn"> & { liveColumn: LiveColumn }): void {
  if (liveColumn.hidden !== 0) problems.constraints.push(`${table}.${column.name} is unexpectedly generated or hidden`);
  const expectedType = column.sqlType ?? "TEXT";
  if (liveColumn.type.toUpperCase() !== expectedType) {
    problems.types.push(`${table}.${column.name} (spec ${expectedType}, DB ${liveColumn.type || "untyped"})`);
  }
  const expectedPrimaryKey = column.name === "id" ? 1 : 0;
  if (liveColumn.pk !== expectedPrimaryKey) {
    problems.primaryKeys.push(`${table}.${column.name} (spec PK ${expectedPrimaryKey}, DB PK ${liveColumn.pk})`);
  }
}

function inspectColumnNullability({ table, tableSpecs, problems, liveColumn, column }: InspectColumnInput): void {
  if (!liveColumn) return;
  const liveNotNull = liveColumn.notnull === 1;
  const specNotNull = !column.optional;
  // Historical migrations may run against the already-widened v33 shape. Nullable resourceId is
  // forward-compatible with every personal v8-v32 row; the current spec still requires it.
  const compatibleV33Widening =
    tableSpecs === V32_TABLES && table === "timeOff" && column.name === "resourceId" && specNotNull && !liveNotNull;
  if (liveNotNull !== specNotNull && !compatibleV33Widening) {
    problems.nullability.push(
      `${table}.${column.name} (spec ${specNotNull ? "required" : "optional"}, ` +
        `DB ${liveNotNull ? "NOT NULL" : "nullable"})`,
    );
  }
}

interface InspectUnexpectedColumnInput {
  column: LiveColumn;
  table: string;
  allowCompatibleExtensions: boolean;
  problems: SchemaProblems;
}

function inspectUnexpectedColumn({
  column,
  table,
  allowCompatibleExtensions,
  problems,
}: InspectUnexpectedColumnInput): void {
  if (!allowCompatibleExtensions) problems.unexpectedColumns.push(`${table}.${column.name}`);
  else if (column.notnull === 1 && column.dflt_value === null)
    problems.unexpectedRequired.push(`${table}.${column.name}`);
  if (column.pk > 0) problems.primaryKeys.push(`${table}.${column.name} is an unexpected primary-key column`);
}

function inspectTableColumns(input: InspectTableInput): void {
  const { table, spec, tableSpecs, allowCompatibleExtensions, problems } = input;
  const liveColumns = schemaColumns(input.db, table);
  const liveByName = new Map(liveColumns.map((column) => [column.name, column]));
  const includedNames = new Set(spec.columns.map((column) => column.name));
  for (const column of spec.columns) {
    inspectColumn({ table, tableSpecs, problems, liveColumn: liveByName.get(column.name), column });
  }
  for (const column of liveColumns) {
    if (includedNames.has(column.name)) continue;
    inspectUnexpectedColumn({ column, table, allowCompatibleExtensions, problems });
  }
}

function inspectUniqueIndexes(db: Db, table: string, constraintProblems: string[]): void {
  const expected =
    table === "clients"
      ? new Map([["clients_one_builtin_per_account", expectedInternalClientIndexSql]])
      : new Map<string, string>();
  const actual = (
    db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string; unique: number; origin: string }>
  ).filter((index) => index.unique === 1 && index.origin !== "pk");
  for (const index of actual) {
    const expectedSql = expected.get(index.name);
    const actualSql = (
      db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`).get(index.name) as
        { sql: string | null } | undefined
    )?.sql;
    if (!expectedSql || !actualSql || normalizeSchemaObjectSql(actualSql) !== expectedSql) {
      constraintProblems.push(`${table}.${index.name} is an unexpected or invalid UNIQUE constraint`);
    }
    expected.delete(index.name);
  }
  for (const name of expected.keys()) constraintProblems.push(`${table}.${name} expected UNIQUE constraint is missing`);
}

function inspectTableConstraints(input: InspectTableConstraintsInput): void {
  const { db, table, tableOption, problems } = input;
  if (tableOption && (tableOption.type !== "table" || tableOption.wr !== 0 || tableOption.strict !== 0)) {
    problems.push(
      `${table} has unsupported table options (type ${tableOption.type}, ` +
        `WITHOUT ROWID ${tableOption.wr}, STRICT ${tableOption.strict})`,
    );
  }
  const tableSql =
    (
      db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as
        { sql: string | null } | undefined
    )?.sql ?? "";
  if (/\bCHECK\s*\(/i.test(tableSql)) problems.push(`${table} has an unexpected CHECK constraint`);
  inspectUniqueIndexes(db, table, problems);
  const unexpectedTriggers = (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?`).all(table) as Array<{
      name: string;
    }>
  ).filter(({ name }) => !name.startsWith("capacitylens_tenant_"));
  for (const trigger of unexpectedTriggers) problems.push(`${table}.${trigger.name} is an unexpected trigger`);
}
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
  const schemaProblems = createSchemaProblems();
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
    inspectTableColumns({ db, table, spec, tableSpecs, allowCompatibleExtensions, problems: schemaProblems });
    const tableOption = tableOptions.get(table);
    inspectTableConstraints({
      db,
      table,
      ...(tableOption ? { tableOption } : {}),
      problems: schemaProblems.constraints,
    });
  }
  inspectForeignKeys({ db, tableSpecs, allowCompatibleExtensions, problems: schemaProblems.foreignKeys });
  const messages = describeSchemaProblems(schemaProblems);
  if (messages.length > 0) throw new Error(`DB schema does not match the current model — ${messages.join(". ")}.`);
}

function inspectForeignKeys(input: InspectForeignKeysInput): void {
  const { db, tableSpecs, allowCompatibleExtensions, problems } = input;
  const allocationsSpec = tableSpecs.allocations;
  if (!allocationsSpec) throw new Error("Missing allocations table specification.");
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
      ...(allocationsSpec.columns.some((column) => column.name === "projectId") ||
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
        problems.push(`${table}.${wanted[0]} -> ${wanted[1]}.${wanted[2]} ON DELETE ${wanted[3]}`);
      }
    }
    if (actual.length !== expected.length) problems.push(`${table} has unexpected foreign-key count`);
  }
}

function describeSchemaProblems(schemaProblems: SchemaProblems): string[] {
  const messages: string[] = [];
  if (schemaProblems.missing.length > 0) {
    messages.push(
      `missing column(s): ${schemaProblems.missing.join(", ")} — migrateSchema auto-adds optional columns, but a ` +
        `new REQUIRED (NOT NULL) column needs an explicit migration step (a table rebuild, like ` +
        `rebuildActivitiesTable) before this DB can open`,
    );
  }
  if (schemaProblems.nullability.length > 0) {
    messages.push(
      `nullability mismatch: ${schemaProblems.nullability.join("; ")} — the spec's optional? flag and SCHEMA_SQL's ` +
        `NOT NULL have drifted; reconcile them (a NOT NULL change to an existing table needs a rebuild)`,
    );
  }
  if (schemaProblems.types.length > 0) messages.push(`declared-type mismatch: ${schemaProblems.types.join("; ")}`);
  if (schemaProblems.primaryKeys.length > 0) {
    messages.push(`primary-key mismatch: ${schemaProblems.primaryKeys.join("; ")}`);
  }
  if (schemaProblems.unexpectedColumns.length > 0) {
    messages.push(
      `unexpected versioned column(s): ${schemaProblems.unexpectedColumns.join(", ")} — a released migration ` +
        `must not include columns owned by a later schema version`,
    );
  }
  if (schemaProblems.unexpectedRequired.length > 0) {
    messages.push(
      `unexpected required column(s): ${schemaProblems.unexpectedRequired.join(", ")} — TABLES inserts cannot ` +
        `supply unknown NOT NULL columns without defaults`,
    );
  }
  if (schemaProblems.constraints.length > 0) {
    messages.push(`unexpected write constraint(s): ${schemaProblems.constraints.join("; ")}`);
  }
  if (schemaProblems.foreignKeys.length > 0) {
    messages.push(`foreign-key mismatch: ${schemaProblems.foreignKeys.join("; ")}`);
  }
  return messages;
}
