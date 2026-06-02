import type { Db } from './db'
import { tx } from './txn'
import { TABLES } from './tables'

// Schema migration + assertion, extracted from db.ts. openDb() runs migrateSchema (bring
// an existing file up to the current shape in place) and then assertSchemaCurrent (fail
// loudly on drift it can't repair). Both introspect the live shape via PRAGMA and are a
// no-op on any fresh / current / already-migrated DB.

interface ColumnInfo {
  name: string
  notnull: number
}

const columns = (db: Db, table: string): ColumnInfo[] =>
  db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfo[]

const hasColumn = (db: Db, table: string, column: string): boolean =>
  columns(db, table).some((c) => c.name === column)

const isNotNull = (db: Db, table: string, column: string): boolean =>
  columns(db, table).some((c) => c.name === column && c.notnull === 1)

/**
 * Bring an existing DB's tables up to the current shape in place. node:sqlite never
 * re-runs CREATE TABLE on an existing table, so a file written by an older schema
 * would otherwise keep the old columns/constraints and break (e.g. seeding a general
 * task hit `NOT NULL constraint failed: tasks.projectId`).
 *
 * INTROSPECTION-GATED and idempotent: it inspects the live shape (PRAGMA table_info) and
 * acts only when something is missing, so a fresh / current / :memory: DB falls straight
 * through with no transaction. It is also GENERIC — every additive OPTIONAL column in the
 * current spec is added automatically, so a new optional field never silently drifts
 * between the client schema and the server DB (the old version-gated pass froze after the
 * first migration and would skip later additions). SQLite can't ALTER-ADD a NOT NULL
 * column to existing rows, so a REQUIRED addition still needs an explicit step (like the
 * tasks rebuild below). Runs with foreign keys OFF (openDb enables them afterwards) so the
 * tasks rebuild's drop/rename is safe.
 */
export function migrateSchema(db: Db): void {
  // Every additive optional column the current spec has that an older table lacks.
  const additions: Array<[string, string]> = []
  for (const [table, spec] of Object.entries(TABLES)) {
    for (const col of spec.columns) {
      if (col.optional && !hasColumn(db, table, col.name)) additions.push([table, col.name])
    }
  }
  // tasks.projectId went from required to optional (general, no-project tasks).
  const needsTasksRebuild = isNotNull(db, 'tasks', 'projectId')
  if (additions.length === 0 && !needsTasksRebuild) return // already current — nothing to do

  tx(db, () => {
    // Optional columns are nullable TEXT (json columns are TEXT too), so a plain ADD
    // COLUMN is safe: existing rows get NULL, which fromRow omits on read.
    for (const [table, name] of additions) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT`)
    // SQLite can't relax a NOT NULL in place, so rebuild tasks when the old constraint
    // is still there. Skipped entirely on a current-shape DB.
    if (needsTasksRebuild) rebuildTasksTable(db)
  })
}

/** 12-step table rebuild (per the SQLite docs) to make tasks.projectId nullable
 *  while preserving rows + the foreign keys other tables hold against tasks(id).
 *  The target DDL mirrors the `tasks` block in SCHEMA_SQL. */
function rebuildTasksTable(db: Db): void {
  db.exec(`
    CREATE TABLE tasks_new (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      projectId TEXT REFERENCES projects(id) ON DELETE CASCADE,
      phaseId TEXT REFERENCES phases(id) ON DELETE SET NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    INSERT INTO tasks_new (id, accountId, name, projectId, phaseId, createdAt, updatedAt)
      SELECT id, accountId, name, projectId, phaseId, createdAt, updatedAt FROM tasks;
    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;
  `)
  // FK checks are deferred (enforcement is OFF here); surface any reference the
  // rebuild left dangling instead of committing a corrupt schema.
  const violations = db.prepare('PRAGMA foreign_key_check').all()
  if (violations.length > 0) {
    throw new Error(`tasks table rebuild left ${violations.length} foreign-key violation(s)`)
  }
}

/**
 * Fail loudly if the live DB has drifted from the current spec in a way migrateSchema can't (or
 * won't) silently repair. Two checks, BOTH a no-op on any fresh / current / already-migrated DB
 * (so neither fires in a normal run) — they exist only to turn a developer mistake into one clear,
 * early, column-naming startup error instead of a confusing runtime symptom much later:
 *
 *  (1) MISSING COLUMN. migrateSchema auto-adds missing OPTIONAL columns, but SQLite can't
 *      ALTER-ADD a NOT NULL column to a table that already has rows, so a future REQUIRED column
 *      added to an existing on-disk DB can't be migrated automatically — it needs an explicit
 *      rebuild step (the way tasks.projectId got one). Otherwise the drift is SILENT: a missing
 *      required column doesn't even throw on read (fromRow yields undefined) and only surfaces as
 *      a cryptic "no column named X" on the first write that names it.
 *
 *  (2) NULLABILITY MISMATCH. A column's optional? flag (object-level, in TABLES) and its
 *      NULL/NOT NULL in SCHEMA_SQL (DB-level) are two hand-maintained sources of truth; nothing
 *      else checks they still agree. A drift is a real bug: a column marked optional but left
 *      NOT NULL rejects a legitimately-omitted field (confusing 400), and a required column left
 *      nullable lets a NULL read back as undefined for a field the model treats as always-present.
 *      The `id` PRIMARY KEY is exempt — PRAGMA table_info reports notnull=0 for a TEXT PK
 *      (a long-standing SQLite quirk), so it would otherwise look like a false mismatch.
 */
export function assertSchemaCurrent(db: Db): void {
  const missing: string[] = []
  const mismatched: string[] = []
  for (const [table, spec] of Object.entries(TABLES)) {
    const live = new Map(columns(db, table).map((c) => [c.name, c.notnull === 1]))
    for (const col of spec.columns) {
      if (!live.has(col.name)) {
        missing.push(`${table}.${col.name}`)
        continue
      }
      if (col.name === 'id') continue // TEXT PRIMARY KEY: PRAGMA reports notnull=0 regardless
      const liveNotNull = live.get(col.name) === true
      const specNotNull = !col.optional
      if (liveNotNull !== specNotNull) {
        mismatched.push(
          `${table}.${col.name} (spec ${specNotNull ? 'required' : 'optional'}, ` +
            `DB ${liveNotNull ? 'NOT NULL' : 'nullable'})`,
        )
      }
    }
  }
  const problems: string[] = []
  if (missing.length > 0) {
    problems.push(
      `missing column(s): ${missing.join(', ')} — migrateSchema auto-adds optional columns, but a ` +
        `new REQUIRED (NOT NULL) column needs an explicit migration step (a table rebuild, like ` +
        `rebuildTasksTable) before this DB can open`,
    )
  }
  if (mismatched.length > 0) {
    problems.push(
      `nullability mismatch: ${mismatched.join('; ')} — the spec's optional? flag and SCHEMA_SQL's ` +
        `NOT NULL have drifted; reconcile them (a NOT NULL change to an existing table needs a rebuild)`,
    )
  }
  if (problems.length > 0) {
    throw new Error(`DB schema is behind the current model — ${problems.join('. ')}.`)
  }
}
