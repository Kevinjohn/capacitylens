import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { emptyAppData } from '@floaty/shared/types/entities'
import type { AppData } from '@floaty/shared/types/entities'
import { TABLES, SCHEMA_SQL, CREATE_ORDER, SCOPED_ORDER } from './tables'
import type { TableSpec } from './tables'

// Thin data-access layer over node:sqlite. No validation here — that is the shared
// domain-core's job (see validate.ts). These helpers only map between SQL rows and
// the plain AppData entity objects the client already speaks.

export type Db = DatabaseSync
type Row = Record<string, unknown>

export function openDb(path: string): Db {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  // A fresh file gets the current shape here; an existing file keeps its tables (IF
  // NOT EXISTS) and is brought up to shape by migrateSchema. Both run with foreign
  // keys still OFF (node:sqlite's default) so a table rebuild can drop/rename safely;
  // we enable enforcement only afterwards.
  db.exec(SCHEMA_SQL)
  migrateSchema(db)
  // Fail loudly if the live DB has drifted from the current spec in a way migrateSchema can't
  // repair — a missing REQUIRED column, or a column whose NULL/NOT NULL disagrees with its
  // optional? flag. Both are silent until a confusing runtime symptom otherwise; see below.
  assertSchemaCurrent(db)
  // Backfill the init marker for a pre-existing DB that already holds data (created
  // before the marker existed), so /api/meta doesn't mistake it for a fresh DB and seed
  // a second copy on top of it.
  if (!isInitialized(db) && !isEmpty(loadState(db))) markInitialized(db)
  db.exec('PRAGMA foreign_keys = ON;') // node:sqlite defaults OFF — our cascades need it
  return db
}

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
function migrateSchema(db: Db): void {
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
function assertSchemaCurrent(db: Db): void {
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

/** Object → SQL row: JSON-encode json columns, undefined → null. */
function toCell(c: TableSpec['columns'][number], v: unknown): SQLInputValue {
  if (v === undefined || v === null) return null
  return (c.json ? JSON.stringify(v) : v) as SQLInputValue
}

function toRow(spec: TableSpec, obj: Row): SQLInputValue[] {
  return spec.columns.map((c) => toCell(c, obj[c.name]))
}

/** SQL row → object: JSON-decode json columns, drop NULL optionals so the result
 *  deep-equals the client's object (which omits absent optionals). */
function fromRow(spec: TableSpec, row: Row): Row {
  const obj: Row = {}
  for (const c of spec.columns) {
    const v = row[c.name]
    if (v === null || v === undefined) {
      if (!c.optional) obj[c.name] = v // required column: keep as-is (shouldn't be null)
      continue
    }
    obj[c.name] = c.json ? JSON.parse(v as string) : v
  }
  return obj
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ')

// Insert one row WITHOUT touching the init marker — the primitive the bulk paths
// (insertAll / replaceAccountSlice) loop over so they can mark ONCE at the end instead of
// re-running an `INSERT OR IGNORE INTO _meta` per row.
function insertRowRaw(db: Db, table: string, obj: Row): void {
  const spec = TABLES[table]
  const cols = spec.columns.map((c) => c.name)
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders(cols.length)})`).run(
    ...toRow(spec, obj),
  )
}

export function insertRow(db: Db, table: string, obj: Row): void {
  insertRowRaw(db, table, obj)
  markInitialized(db)
}

/** Idempotent insert-or-replace by id — the write the sync adapter uses for every
 *  create/update, so replaying a batch after a partial failure can't double-insert
 *  (a re-PUT of an already-written row just overwrites it). */
export function upsertRow(db: Db, table: string, obj: Row): void {
  const spec = TABLES[table]
  const cols = spec.columns.map((c) => c.name)
  // Exclude id (the conflict key) AND createdAt from the UPDATE: createdAt is immutable
  // (entities.ts calls it "impossible to backfill"), so a re-PUT must never rewrite the
  // original creation time, and a body that omits it must not null it out on update.
  const setCols = cols.filter((c) => c !== 'id' && c !== 'createdAt')
  const set = setCols.map((c) => `${c} = excluded.${c}`).join(', ')
  db.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders(cols.length)}) ` +
      `ON CONFLICT(id) DO UPDATE SET ${set}`,
  ).run(...toRow(spec, obj))
  markInitialized(db)
}

/** Idempotent: deleting an absent id is a no-op (the store's cascade and the DB's
 *  ON DELETE can both target the same row; whichever loses the race must not error). */
export function deleteRow(db: Db, table: string, id: string): void {
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
}

export function getRow(db: Db, table: string, id: string): Row | undefined {
  const spec = TABLES[table]
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
  return row ? fromRow(spec, row) : undefined
}

/** Assemble the whole AppData tree from the tables. */
export function loadState(db: Db): AppData {
  const data = emptyAppData() as unknown as Record<string, Row[]>
  for (const table of CREATE_ORDER) {
    const spec = TABLES[table]
    data[table] = db.prepare(`SELECT * FROM ${table}`).all().map((r) => fromRow(spec, r))
  }
  return data as unknown as AppData
}

export function isEmpty(data: AppData): boolean {
  return Object.values(data).every((v) => Array.isArray(v) && v.length === 0)
}

/** Persistent "this dataset has been initialised" marker, set on the first write. Unlike
 *  a row count it SURVIVES the user emptying their data, so /api/meta can tell a
 *  genuinely-fresh DB (seed it) from one the user deliberately cleared (don't re-seed) —
 *  mirroring the web app's "storage key present" semantics, where the two diverged. */
export function markInitialized(db: Db): void {
  db.prepare(`INSERT OR IGNORE INTO _meta (key, value) VALUES ('initialized', '1')`).run()
}

export function isInitialized(db: Db): boolean {
  const row = db.prepare(`SELECT value FROM _meta WHERE key = 'initialized'`).get() as
    | { value?: string }
    | undefined
  return row?.value === '1'
}

/** First-run seeding gate used by the server entrypoint: seed ONLY a never-initialised DB.
 *  Gated on the persistent `initialized` marker — which survives the user emptying their
 *  data — NOT on mere emptiness, so a user who deletes everything is NOT handed the demo
 *  dataset back on the next restart (the same predicate /api/meta reports). Seeding sets
 *  the marker, so it fires exactly once. Returns whether it seeded. */
export function seedIfUninitialized(db: Db, data: AppData): boolean {
  if (isInitialized(db)) return false
  insertAll(db, data)
  return true
}

function tx(db: Db, fn: () => void): void {
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/** Insert an entire AppData tree (parent-first). Used by seeding and reset. */
export function insertAll(db: Db, data: AppData): void {
  const d = data as unknown as Record<string, Row[]>
  tx(db, () => {
    for (const table of CREATE_ORDER) for (const row of d[table] ?? []) insertRowRaw(db, table, row)
    markInitialized(db) // once for the whole batch, not per row
  })
}

/** Wipe every table (children-first so FK checks stay satisfied within the tx). Also
 *  clears the init marker — a full wipe is a factory reset, so the next load seeds
 *  again (unlike a user deleting their entities, which keeps the marker). */
export function wipe(db: Db): void {
  tx(db, () => {
    for (let i = CREATE_ORDER.length - 1; i >= 0; i--) db.exec(`DELETE FROM ${CREATE_ORDER[i]}`)
    db.exec(`DELETE FROM _meta`)
  })
}

/** Replace one account's scoped slice with the rows for that account in `next`.
 *  Used by /api/import (the store imports into the active account only). */
export function replaceAccountSlice(db: Db, accountId: string, next: AppData): void {
  const d = next as unknown as Record<string, Row[]>
  tx(db, () => {
    for (let i = SCOPED_ORDER.length - 1; i >= 0; i--) {
      db.prepare(`DELETE FROM ${SCOPED_ORDER[i]} WHERE accountId = ?`).run(accountId)
    }
    for (const table of SCOPED_ORDER) {
      for (const row of d[table] ?? []) if (row.accountId === accountId) insertRowRaw(db, table, row)
    }
    markInitialized(db) // once for the whole slice, not per row
  })
}
