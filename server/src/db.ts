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
  db.exec('PRAGMA foreign_keys = ON;') // node:sqlite defaults OFF — our cascades need it
  db.exec(SCHEMA_SQL)
  return db
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
