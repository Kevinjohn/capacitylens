import type { Db } from "../db";
import { TABLES } from "../tables";
import type { TableSpec } from "../tables";
import { tx } from "../txn";
import { V8_TABLES } from "./historicalSpecs";
import { hasColumn, isNotNull, tableExists } from "./introspection";
/**
 * Legacy rename: the domain concept "Task" was renamed "Activity" (schema v5), so an on-disk DB
 * written by an older server still has a `tasks` table and an `allocations.taskId` FK column.
 * Rename them in place to `activities` / `activityId` before openDb runs `CREATE TABLE IF NOT
 * EXISTS activities` (which would otherwise leave the old `tasks` table orphaned and create a
 * fresh, empty `activities`, silently abandoning the user's rows). A pure structural rename:
 * no rows or values change, and the kind strings are untouched.
 *
 * Idempotent + introspection-gated: it acts only when the legacy shape is present (`tasks` table
 * exists and `activities` does not / `allocations.taskId` exists and `activityId` does not), so a
 * fresh, current, or already-migrated DB falls straight through with no transaction. Runs with
 * foreign keys OFF (openDb enables them afterwards) so renaming a referenced table is safe.
 *
 * Must run before the baseline DDL (SCHEMA_V8_SQL in the v8 baseline migration), otherwise the
 * IF-NOT-EXISTS create of `activities` wins the race and the rename's guard (`activities` absent)
 * never fires, abandoning the legacy rows.
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

// Use the selected historical contract for optional-column repair; released migrations must not absorb later fields.
// Required activity-column changes need a table rebuild with rows preserved and foreign keys rechecked.
function migrateSchemaVersion(
  db: Db,
  tableSpecs: Record<string, TableSpec>,
  skippedOptionalColumns: ReadonlySet<string> = new Set(),
): void {
  // Every additive optional column the selected version's spec has that an older table lacks.
  const additions: Array<[string, string]> = [];
  for (const [table, spec] of Object.entries(tableSpecs)) {
    for (const col of spec.columns) {
      if (col.optional && !skippedOptionalColumns.has(`${table}.${col.name}`) && !hasColumn(db, table, col.name)) {
        additions.push([table, col.name]);
      }
    }
  }
  // Rebuild the immutable baseline activity shape when projectId is required or kind is absent.
  const activitiesHadKind = hasColumn(db, "activities", "kind");
  const needsActivitiesRebuild = isNotNull(db, "activities", "projectId") || !activitiesHadKind;
  // Skip the transaction when the schema already matches the current shape.
  if (additions.length === 0 && !needsActivitiesRebuild) return;

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
  // Activity lifecycle tombstones are owned by the explicit v36 migration. Keep the generic
  // pre-ledger repair from silently adding them before historical migration assertions run.
  migrateSchemaVersion(
    db,
    TABLES,
    new Set([
      "activities.archivedAt",
      "activities.deletedAt",
      // Account task visibility and allocation task text are owned by the v37 ledger step.
      "accounts.showTaskFieldInSchedule",
      "allocations.task",
      "resources.firstAvailableDate",
      "resources.lastAvailableDate",
      "accounts.capacityOverviewAccess",
      "accounts.dateStyle",
      "resources.avatarUrl",
    ]),
  );
}

// Rebuild to the immutable pre-v36 activity shape while retaining source kind values.
// Only pre-kind rows derive kind from project presence. Recreate auxiliary indexes, triggers and constraints after drop/rename; otherwise the migration would discard them.
// Preserve released migration behavior and recheck foreign keys before commit.
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
  // FK checks are deferred (enforcement is off here); surface any reference the
  // rebuild left dangling instead of committing a corrupt schema.
  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0) {
    throw new Error(`activities table rebuild left ${violations.length} foreign-key violation(s)`);
  }
}
