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

// Bump whenever the on-disk SQL shape changes in a way migrateSchema must repair.
// Stored in the file's PRAGMA user_version so an up-to-date DB skips migration work.
const SCHEMA_USER_VERSION = 1

export function openDb(path: string): Db {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  // A fresh file gets the current shape here; an existing file keeps its tables (IF
  // NOT EXISTS) and is brought up to shape by migrateSchema. Both run with foreign
  // keys still OFF (node:sqlite's default) so a table rebuild can drop/rename safely;
  // we enable enforcement only afterwards.
  db.exec(SCHEMA_SQL)
  migrateSchema(db)
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
 * Every step is INTROSPECTION-GATED, not version-gated: it inspects the live shape
 * (PRAGMA table_info) and acts only when the old shape is still present. That makes
 * the whole pass idempotent and a harmless no-op on an already-current DB — fresh or
 * `:memory:` DBs created from SCHEMA_SQL fall straight through. The user_version is
 * only a fast-path to skip the introspection once a DB is known to be current.
 *
 * Runs with foreign keys OFF (openDb enables them afterwards) so the tasks rebuild's
 * drop/rename is safe.
 */
function migrateSchema(db: Db): void {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (user_version >= SCHEMA_USER_VERSION) return

  tx(db, () => {
    // Additive columns (schedulingMode on accounts, ignoreWeekends on allocations):
    // ADD COLUMN only when missing, so a current-shape DB is untouched.
    if (!hasColumn(db, 'accounts', 'schedulingMode')) {
      db.exec('ALTER TABLE accounts ADD COLUMN schedulingMode TEXT')
    }
    if (!hasColumn(db, 'allocations', 'ignoreWeekends')) {
      db.exec('ALTER TABLE allocations ADD COLUMN ignoreWeekends TEXT')
    }
    // tasks.projectId went from required to optional (general, no-project tasks).
    // SQLite can't relax a column's NOT NULL in place, so rebuild the table when the
    // old constraint is still there. Skipped entirely on a current-shape DB.
    if (isNotNull(db, 'tasks', 'projectId')) rebuildTasksTable(db)
  })
  db.exec(`PRAGMA user_version = ${SCHEMA_USER_VERSION}`)
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

export function insertRow(db: Db, table: string, obj: Row): void {
  const spec = TABLES[table]
  const cols = spec.columns.map((c) => c.name)
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders(cols.length)})`).run(
    ...toRow(spec, obj),
  )
}

/** Idempotent insert-or-replace by id — the write the sync adapter uses for every
 *  create/update, so replaying a batch after a partial failure can't double-insert
 *  (a re-PUT of an already-written row just overwrites it). */
export function upsertRow(db: Db, table: string, obj: Row): void {
  const spec = TABLES[table]
  const cols = spec.columns.map((c) => c.name)
  const setCols = cols.filter((c) => c !== 'id')
  const set = setCols.map((c) => `${c} = excluded.${c}`).join(', ')
  db.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders(cols.length)}) ` +
      `ON CONFLICT(id) DO UPDATE SET ${set}`,
  ).run(...toRow(spec, obj))
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
    for (const table of CREATE_ORDER) for (const row of d[table] ?? []) insertRow(db, table, row)
  })
}

/** Wipe every table (children-first so FK checks stay satisfied within the tx). */
export function wipe(db: Db): void {
  tx(db, () => {
    for (let i = CREATE_ORDER.length - 1; i >= 0; i--) db.exec(`DELETE FROM ${CREATE_ORDER[i]}`)
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
      for (const row of d[table] ?? []) if (row.accountId === accountId) insertRow(db, table, row)
    }
  })
}
