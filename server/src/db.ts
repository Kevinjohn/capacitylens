import { DatabaseSync } from 'node:sqlite'
import { emptyAppData, isEmpty } from '@capacitylens/shared/types/entities'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'
import type { AppData } from '@capacitylens/shared/types/entities'

// Re-export the shared isEmpty so existing import sites (e.g. db.migrate.test.ts)
// keep resolving it from this module; the single definition lives in shared/types.
export { isEmpty }
import { TABLES, SCHEMA_SQL, CREATE_ORDER, SCOPED_ORDER } from './tables'
import { tx } from './txn'
import { toRow, fromRow, type Row } from './rowCodec'
import { migrateSchema, assertSchemaCurrent, renameLegacyActivityTables } from './schema'

// Thin data-access layer over node:sqlite. No validation here — that is the shared
// domain-core's job (see validate.ts). These helpers only map between SQL rows and the
// plain AppData entity objects the client already speaks. The row<->object codecs live in
// ./rowCodec, schema migration/assertion in ./schema, and the tx() helper in ./txn; this
// module owns openDb plus the CRUD / bulk / init-marker primitives the routes call.

export type Db = DatabaseSync

// `table` is interpolated DIRECTLY into the SQL strings below (SQL can't parameterise an
// identifier), so it MUST be a vetted key of TABLES — this is the SQL-injection safety boundary.
// Every route already gates the table name through isKnownTable before reaching these primitives;
// this assertion is defence-in-depth (a future caller can't turn an unchecked string into an
// injection point) and turns a cryptic "cannot read properties of undefined" into a clear message.
// One own-property lookup — `Object.hasOwn`, not `in`, so a prototype key like "constructor" can't
// masquerade as a table.
function assertKnownTable(table: string): void {
  if (!Object.hasOwn(TABLES, table)) {
    throw new Error(`Unknown table "${table}" — not a known entity table (SQL-identifier safety guard).`)
  }
}

export function openDb(path: string): Db {
  let db: Db
  try {
    db = new DatabaseSync(path)
  } catch (e) {
    // Boot SHOULD crash on an unopenable DB — but frame the raw node:sqlite error with the path so
    // an operator sees "could not open <CAPACITYLENS_DB>" instead of a bare stack. Rethrow (don't swallow).
    throw new Error(
      `Could not open the SQLite database at "${path}": ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    )
  }
  db.exec('PRAGMA journal_mode = WAL;')
  // Wait up to 5s for a held lock instead of throwing SQLITE_BUSY immediately — two server
  // processes on the same CAPACITYLENS_DB file (or a WAL checkpoint) contend rather than error.
  db.exec('PRAGMA busy_timeout = 5000;')
  // Legacy domain rename (Task→Activity, schema v5): bring an old DB's `tasks` table and
  // `allocations.taskId` column to `activities` / `activityId` BEFORE SCHEMA_SQL — otherwise
  // its `CREATE TABLE IF NOT EXISTS activities` would create a fresh empty table and orphan the
  // legacy rows. A no-op on any fresh / current / already-migrated DB. FKs are still OFF here.
  renameLegacyActivityTables(db)
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
  // Built-in "Internal" client per account (schema v6): mirror the shared migrate (migrateV5toV6)
  // so a server-loaded dataset written by an older server, or seeded externally, also gets exactly
  // one builtin Internal client per account. Idempotent — only inserts where one is missing. Runs
  // BEFORE foreign keys are enabled (the insert references accounts(id), already present).
  //
  // This is a BOOT-TIME BACKFILL, NOT the runtime path. A LIVE account created through the API gets
  // its Internal from the CLIENT — the web store's addAccount mints account+Internal atomically and
  // syncs them as separate entity writes (account before client). The server must NOT auto-mint on
  // account-create: the client's own Internal would then be a second builtin and validateWrite's
  // wouldAddSecondBuiltin would reject it, breaking sync. See shared ensureInternalClients' ownership
  // contract. So an account POSTed via the API without a paired Internal write stays Internal-less
  // until the next open backfills it — an unsupported/degraded path the web app never takes.
  ensureInternalClients(db)
  db.exec('PRAGMA foreign_keys = ON;') // node:sqlite defaults OFF — our cascades need it
  return db
}

/**
 * Ensure EVERY account in the DB has exactly one built-in Internal client (`builtin: true`).
 * IDEMPOTENT: a single LEFT-JOIN query finds accounts with no builtin client and inserts one each,
 * so it never creates a duplicate and is safe on every open (fresh / seeded / already-migrated). The
 * server mirror of the shared `migrateV5toV6`; identifies the Internal client by the FLAG, not an id.
 *
 * Stays SQL (set-based, runs inside the DB) rather than calling the shared TS helper, but the CANONICAL
 * definition of "the account's builtin Internal" lives in shared `internalClientFor` /
 * `ensureInternalClients` — the `builtin = 'true'` predicate below is its SQL transcription, and the
 * inserted row is built by the shared `buildInternalClient` factory so the row shape can't drift.
 */
function ensureInternalClients(db: Db): void {
  const accountsMissing = db
    .prepare(
      `SELECT a.id AS id FROM accounts a
       WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.accountId = a.id AND c.builtin = 'true')`,
    )
    .all() as Array<{ id: string }>
  if (accountsMissing.length === 0) return
  const now = new Date().toISOString()
  tx(db, () => {
    for (const { id } of accountsMissing) insertRowRaw(db, 'clients', buildInternalClient(id, now) as unknown as Row)
  })
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ')

// Insert one row WITHOUT touching the init marker — the primitive the bulk paths
// (insertAll / replaceAccountSlice) loop over so they can mark ONCE at the end instead of
// re-running an `INSERT OR IGNORE INTO _meta` per row.
function insertRowRaw(db: Db, table: string, obj: Row): void {
  assertKnownTable(table)
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
  assertKnownTable(table)
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
  assertKnownTable(table)
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
}

export function getRow(db: Db, table: string, id: string): Row | undefined {
  assertKnownTable(table)
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
