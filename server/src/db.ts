import { DatabaseSync } from 'node:sqlite'
import { emptyAppData, isEmpty, SCHEMA_VERSION } from '@capacitylens/shared/types/entities'
import {
  buildInternalClient,
  INTERNAL_CLIENT_COLOR,
  INTERNAL_CLIENT_NAME,
} from '@capacitylens/shared/data/internalClient'
import { activeOnly } from '@capacitylens/shared/domain/lifecycle'
import type { AppData } from '@capacitylens/shared/types/entities'

// Re-export the shared isEmpty so existing import sites (e.g. db.migrate.test.ts)
// keep resolving it from this module; the single definition lives in shared/types.
export { isEmpty }
import { TABLES, SCHEMA_SQL, CREATE_ORDER, SCOPED_ORDER, INTERNAL_CLIENT_UNIQUE_INDEX_SQL } from './tables'
import { tx } from './txn'
import { toRow, fromRow, type Row } from './rowCodec'
import { migrateSchema, assertSchemaCurrent, renameLegacyActivityTables } from './schema'
import { ensureControlTables } from './controlTables'

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
  const diskVersion = Number((db.prepare('PRAGMA user_version').get() as { user_version?: number }).user_version ?? 0)
  if (diskVersion > SCHEMA_VERSION) {
    db.close()
    throw new Error(
      `Database schema version ${diskVersion} is newer than this server supports (${SCHEMA_VERSION}); refusing a downgrade.`,
    )
  }
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
  // Server-CONTROL tables (membership, P1.1) — created on EVERY open, regardless of auth mode, so
  // both the runtime and the in-memory test DBs always have them. Deliberately created HERE rather
  // than alongside Better Auth's migrations (which only run when auth is on): membership must exist
  // even in the default off-mode/test posture for the helpers to work. These tables sit OUTSIDE the
  // AppData drift path (see controlTables.ts) — they carry no FK to AppData, so this is independent
  // of the foreign-keys pragma flip below; placed with the other schema work for locality.
  ensureControlTables(db)
  // Backfill the init marker for a pre-existing DB that already holds data (created
  // before the marker existed), so /api/meta doesn't mistake it for a fresh DB and seed
  // a second copy on top of it.
  if (!isInitialized(db) && !isEmpty(loadState(db))) markInitialized(db)
  // Reconcile legacy missing/duplicate Internal rows before installing the database singleton guard.
  // Runtime account creation also mints the account + Internal atomically.
  ensureInternalClients(db)
  db.exec(INTERNAL_CLIENT_UNIQUE_INDEX_SQL)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  db.exec('PRAGMA foreign_keys = ON;') // node:sqlite defaults OFF — our cascades need it
  return db
}

/**
 * Ensure EVERY account in the DB has exactly one built-in Internal client (`builtin: true`).
 * Missing rows are inserted; duplicate rows are deterministically folded into the generated id when
 * present (otherwise the oldest/id-first row), with dependent projects rewired before deletion. The
 * partial unique index is installed after this repair and prevents recurrence.
 *
 * Stays SQL (set-based, runs inside the DB) rather than calling the shared TS helper, but the CANONICAL
 * definition of "the account's builtin Internal" lives in shared `internalClientFor` /
 * `ensureInternalClients` — the `builtin = 'true'` predicate below is its SQL transcription, and the
 * inserted row is built by the shared `buildInternalClient` factory so the row shape can't drift.
 */
function ensureInternalClients(db: Db): void {
  const accounts = db.prepare(`SELECT id FROM accounts ORDER BY id`).all() as Array<{ id: string }>
  const now = new Date().toISOString()
  tx(db, () => {
    for (const { id } of accounts) {
      const builtins = db.prepare(
        `SELECT id FROM clients WHERE accountId = ? AND builtin = 'true'
         ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, createdAt, id`,
      ).all(id, `internal:${id}`) as Array<{ id: string }>
      if (builtins.length === 0) {
        insertRowRaw(db, 'clients', buildInternalClient(id, now) as unknown as Row)
        continue
      }
      const retainedId = builtins[0].id
      db.prepare(
        `UPDATE clients SET name = ?, color = ?, builtin = 'true' WHERE id = ? AND accountId = ?`,
      ).run(INTERNAL_CLIENT_NAME, INTERNAL_CLIENT_COLOR, retainedId, id)
      for (const duplicate of builtins.slice(1)) {
        db.prepare(`UPDATE projects SET clientId = ? WHERE clientId = ?`).run(retainedId, duplicate.id)
        db.prepare(`DELETE FROM clients WHERE id = ?`).run(duplicate.id)
      }
    }
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

/**
 * Read ONLY one account's slice of AppData — the per-account scoped read primitive (P1.4).
 *
 * Returns an AppData whose `accounts` array is the single requested account (0 rows if it does not
 * exist) and whose every SCOPED table holds ONLY rows where `accountId = accountId`. The result has
 * EVERY AppData key present (it starts from {@link emptyAppData}), so a consumer never sees a missing
 * table even when an account has no rows in it.
 *
 * NO-CROSS-TENANT INVARIANT: every scoped query carries `WHERE accountId = ?`, and the only global
 * table (`accounts`) is read by its id (`WHERE id = ?`). No query here omits its predicate, so this
 * function can NEVER return a row belonging to another account — the tenant-isolation guarantee the
 * {@link TenantStore} seam rests on (see tenantStore.ts).
 *
 * UNKNOWN accountId: not an error. An id with no matching account yields `accounts: []` plus an empty
 * array for every scoped table — degrade to "empty slice", never throw (a stale/typo'd id from a
 * client is a 0-row read, not a corruption signal). Rows are mapped through the SAME `fromRow` codec
 * {@link loadState} uses, so optional/json columns round-trip identically.
 *
 * FIELD-LEVEL REDACTION (P1.6): `opts.includeTimeOffNote` is REQUIRED — there is no silent default, so
 * every caller must DECIDE the visibility of the owner/admin-only time-off `note` (the access rule
 * lives in `canSeeTimeOffNote`, shared/domain/access). When `false`, the `note` key is STRIPPED from every returned `timeOff`
 * row HERE, server-side — so an Editor/Viewer's read can never serialize the note onto the wire. When
 * `true`, the note is returned as stored. This is a payload-narrowing rule, not a request gate: the
 * read is already authorized; this only decides which columns leave the server.
 *
 * LIFECYCLE PROJECTION (P2.4): `opts.includeInactive` is REQUIRED, mirroring `includeTimeOffNote` (no
 * silent default — every caller DECIDES). When `false` (the normal app read), the SHARED `activeOnly`
 * helper is applied AFTER the note redaction, dropping every NON-active (archived OR soft-deleted)
 * resource/client/project from the returned slice — exactly the rows the normal views hide. The rows
 * REMAIN in the DB and in EXPORT; this only narrows what the per-account read serializes. When `true`
 * (P2.5's admin "Archived & deleted" read), the full slice is returned untouched. Composition order is
 * load-bearing: redact the note FIRST, then `activeOnly` — the two narrowings are independent, and
 * applying `activeOnly` last keeps it a single, total projection over the already-redacted slice.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account whose slice to read.
 * @param opts.includeTimeOffNote  REQUIRED. `true` keeps each time-off `note`; `false` strips it
 *                                 (owner/admin-only field — redacted before it leaves the server).
 * @param opts.includeInactive  REQUIRED. `false` drops archived/soft-deleted resources/clients/projects
 *                              (the normal app read); `true` returns every row (the P2.5 admin read).
 * @returns An AppData containing ONLY `accountId`'s data (every key present; arrays may be empty).
 */
export function readSlice(
  db: Db,
  accountId: string,
  opts: { includeTimeOffNote: boolean; includeInactive: boolean },
): AppData {
  const data = emptyAppData() as unknown as Record<string, Row[]>
  // The single global table: read the ONE account by id (0 or 1 row), via the same codec loadState uses.
  const accountsSpec = TABLES['accounts']
  data['accounts'] = db
    .prepare(`SELECT * FROM accounts WHERE id = ?`)
    .all(accountId)
    .map((r) => fromRow(accountsSpec, r))
  // Every scoped table: WHERE accountId = ? — never an unpredicated read (the no-cross-tenant invariant).
  for (const table of SCOPED_ORDER) {
    const spec = TABLES[table]
    data[table] = db
      .prepare(`SELECT * FROM ${table} WHERE accountId = ?`)
      .all(accountId)
      .map((r) => fromRow(spec, r))
  }
  // P1.6 field-level redaction: drop the owner/admin-only `note` from every time-off row when the
  // caller may not see it. Delete the KEY (so the optional field is absent, matching its TimeOff
  // shape — not a null), and do it on the built objects BEFORE returning so the note is never
  // serialized for an Editor/Viewer read.
  if (!opts.includeTimeOffNote) {
    for (const row of data['timeOff']) delete (row as Record<string, unknown>).note
  }
  // P2.4 lifecycle projection: for the NORMAL app read (includeInactive:false), drop every NON-active
  // (archived/soft-deleted) resource/client/project via the SHARED activeOnly helper — the SAME rule
  // the client views use (useActiveScopedData), so the two halves can't drift. Applied AFTER the note
  // redaction so the projection runs over the already-redacted slice. includeInactive:true (P2.5's
  // admin read) returns the full slice untouched. The dropped rows stay in the DB + export.
  if (!opts.includeInactive) return activeOnly(data as unknown as AppData)
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
 *  Used by /api/import, the P2.5 lifecycle routes (archive/unarchive/delete/purge), and
 *  TenantStore.write — every path that rewrites one account's scoped tables wholesale.
 *  Callers must read the full slice first: the rewrite erases any sibling row not re-supplied. */
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
