import type { Db } from "../db";
import { TABLES, type TableSpec } from "../tables";
import { tx } from "../txn";
import { V8_TABLES } from "./historicalSpecs";
import { hasColumn, isNotNull, tableExists } from "./introspection";
/**
 * Legacy rename: the domain concept "Task" was renamed "Activity" (schema v5), so an on-disk DB
 * written by an OLDER server still has a `tasks` table and an `allocations.taskId` FK column.
 * Rename them in place to `activities` / `activityId` BEFORE openDb runs `CREATE TABLE IF NOT
 * EXISTS activities` (which would otherwise leave the old `tasks` table orphaned and create a
 * fresh, EMPTY `activities` — silently abandoning the user's rows). A pure structural rename:
 * no rows or values change, and the kind strings are untouched.
 *
 * IDEMPOTENT + introspection-gated: it acts ONLY when the legacy shape is present (`tasks` table
 * exists AND `activities` does not / `allocations.taskId` exists AND `activityId` does not), so a
 * fresh, current, or already-migrated DB falls straight through with no transaction. Runs with
 * foreign keys OFF (openDb enables them afterwards) so renaming a referenced table is safe.
 *
 * MUST run before SCHEMA_SQL — otherwise the IF-NOT-EXISTS create of `activities` wins the race
 * and the rename's guard (`activities` absent) never fires, abandoning the legacy rows.
 */
export function renameLegacyActivityTables(db: Db): void {
  // Rename the table only when the old one exists and the new one hasn't been created yet.
  if (tableExists(db, "tasks") && !tableExists(db, "activities")) {
    db.exec("ALTER TABLE tasks RENAME TO activities");
  }
  // Rename the allocations FK column independently (an old DB has it; renaming a column doesn't
  // touch the referenced table). Guarded so a half-migrated or current DB is a no-op.
  if (
    tableExists(db, "allocations") &&
    hasColumn(db, "allocations", "taskId") &&
    !hasColumn(db, "allocations", "activityId")
  ) {
    db.exec("ALTER TABLE allocations RENAME COLUMN taskId TO activityId");
  }
}

/**
 * Bring an existing DB's tables up to the current shape in place. node:sqlite never
 * re-runs CREATE TABLE on an existing table, so a file written by an older schema
 * would otherwise keep the old columns/constraints and break (e.g. seeding a general
 * activity hit `NOT NULL constraint failed: activities.projectId`).
 *
 * INTROSPECTION-GATED and idempotent: it inspects the live shape (PRAGMA table_info) and
 * acts only when something is missing, so a fresh / current / :memory: DB falls straight
 * through with no transaction. It is also GENERIC — every additive OPTIONAL column in the
 * current spec is added automatically, so a new optional field never silently drifts
 * between the client schema and the server DB (the old version-gated pass froze after the
 * first migration and would skip later additions). SQLite can't ALTER-ADD a NOT NULL
 * column to existing rows, so a REQUIRED addition still needs an explicit step (like the
 * activities rebuild below). Runs with foreign keys OFF (openDb enables them afterwards) so the
 * activities rebuild's drop/rename is safe.
 */
function migrateSchemaVersion(db: Db, tableSpecs: Record<string, TableSpec>): void {
  // Every additive optional column the selected version's spec has that an older table lacks.
  const additions: Array<[string, string]> = [];
  for (const [table, spec] of Object.entries(tableSpecs)) {
    for (const col of spec.columns) {
      if (col.optional && !hasColumn(db, table, col.name)) additions.push([table, col.name]);
    }
  }
  // activities needs a rebuild when an OLD-shape constraint is still present: projectId was once
  // NOT NULL (before general, no-project activities), and `kind` is a required column added in v4
  // that SQLite can't ALTER-ADD as NOT NULL to a table with rows. Either condition → rebuild
  // to the current shape (nullable projectId, kind backfilled from projectId presence).
  const activitiesHadKind = hasColumn(db, "activities", "kind");
  const needsActivitiesRebuild = isNotNull(db, "activities", "projectId") || !activitiesHadKind;
  if (additions.length === 0 && !needsActivitiesRebuild) return; // already current — nothing to do

  tx(db, () => {
    // Optional columns are nullable TEXT (json columns are TEXT too), so a plain ADD
    // COLUMN is safe: existing rows get NULL, which fromRow omits on read.
    for (const [table, name] of additions) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT`);
    // SQLite can't relax a NOT NULL in place, so rebuild activities when the old constraint
    // is still there. Skipped entirely on a current-shape DB.
    if (needsActivitiesRebuild) rebuildActivitiesTable(db, activitiesHadKind);
  });
}

/** Bring legacy v0–v7 databases to the immutable v8 baseline shape. */
export function migrateSchemaV8(db: Db): void {
  migrateSchemaVersion(db, V8_TABLES);
}

/** Bring a database to the current shape. Explicit versioned migrations normally make this a no-op;
 * it remains the introspection-gated repair path for pre-ledger legacy columns. */
export function migrateSchema(db: Db): void {
  migrateSchemaVersion(db, TABLES);
}

/** Rebuild the `activities` table (the SQLite-docs 'create new + copy + drop + rename' approach,
 *  simplified — there are no indexes/triggers/views to carry over, see the ASSUMPTION below) to bring
 *  it to the current shape —
 *  nullable projectId AND a required `kind` column — while preserving rows + the foreign keys
 *  other tables hold against activities(id). The target DDL mirrors the `activities` block in SCHEMA_SQL.
 *  `kind` is preserved when the source schema already has it. Only genuinely pre-kind schemas
 *  derive it from projectId presence ('project' versus 'repeatable').
 *
 *  ASSUMPTION (true today, verified): `activities` has NO indexes, triggers, or extra constraints
 *  beyond the inline column ones. The drop+rename silently discards any such auxiliary object, so
 *  if one is ever added to `activities`, this rebuild must be updated to recreate it AFTER the rename —
 *  otherwise a migration would quietly lose it. (If that risk grows, gate with a PRAGMA index_list
 *  check that throws on anything unexpected.) */
function rebuildActivitiesTable(db: Db, sourceHasKind: boolean): void {
  const kindExpression = sourceHasKind
    ? "kind"
    : `CASE WHEN projectId IS NOT NULL THEN 'project' ELSE 'repeatable' END`;
  db.exec(`
    CREATE TABLE activities_new (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      projectId TEXT REFERENCES projects(id) ON DELETE CASCADE,
      phaseId TEXT REFERENCES phases(id) ON DELETE SET NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    INSERT INTO activities_new (id, accountId, name, kind, projectId, phaseId, createdAt, updatedAt)
      SELECT id, accountId, name,
        ${kindExpression},
        projectId, phaseId, createdAt, updatedAt FROM activities;
    DROP TABLE activities;
    ALTER TABLE activities_new RENAME TO activities;
  `);
  // FK checks are deferred (enforcement is OFF here); surface any reference the
  // rebuild left dangling instead of committing a corrupt schema.
  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0) {
    throw new Error(`activities table rebuild left ${violations.length} foreign-key violation(s)`);
  }
}
