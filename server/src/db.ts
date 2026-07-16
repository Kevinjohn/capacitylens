import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync } from 'node:fs'
import { emptyAppData, isEmpty } from '@capacitylens/shared/types/entities'
import {
  buildInternalClient,
  INTERNAL_CLIENT_COLOR,
  INTERNAL_CLIENT_NAME,
} from '@capacitylens/shared/data/internalClient'
import { activeOnly } from '@capacitylens/shared/domain/lifecycle'
import { redactPrivateNames } from '@capacitylens/shared/domain/privateNames'
import type { AppData } from '@capacitylens/shared/types/entities'

// Re-export the shared isEmpty so existing import sites (e.g. db.migrate.test.ts)
// keep resolving it from this module; the single definition lives in shared/types.
export { isEmpty }
import { TABLES, SCHEMA_V8_SQL, CREATE_ORDER, SCOPED_ORDER, INTERNAL_CLIENT_UNIQUE_INDEX_SQL } from './tables'
import { tx } from './txn'
import { toRow, fromRow, type Row } from './rowCodec'
import { assertSchemaCurrent, assertSchemaV8, migrateSchemaV8, renameLegacyActivityTables } from './schema'
import { assertControlTablesCurrent, ensureControlTables } from './controlTables'

// Thin data-access layer over node:sqlite. No validation here — that is the shared
// domain-core's job (see validate.ts). These helpers only map between SQL rows and the
// plain AppData entity objects the client already speaks. The row<->object codecs live in
// ./rowCodec, schema migration/assertion in ./schema, and the tx() helper in ./txn; this
// module owns openDb plus the CRUD / bulk / init-marker primitives the routes call.

export type Db = DatabaseSync

/** Physical SQLite schema version. Independent from the portable JSON/export schema version. */
export const DB_SCHEMA_VERSION = 9

/** `CPLN` in ASCII. SQLite reserves application_id for applications to identify their files. */
export const CAPACITYLENS_APPLICATION_ID = 0x43504c4e

interface DatabaseMigration {
  version: number
  name: string
  checksum: string
  up(db: Db): void
}

export interface DatabaseMigrationPlan {
  fromVersion: number
  toVersion: number
  fresh: boolean
  migrations: ReadonlyArray<Pick<DatabaseMigration, 'version' | 'name' | 'checksum'>>
}

export interface DatabaseMigrationHooks {
  /** Test/rehearsal seam: runs after the migration, history row and version stamps, immediately
   * before COMMIT. Throwing (or terminating the process) must leave the previous version intact. */
  beforeCommit?(migration: Readonly<Pick<DatabaseMigration, 'version' | 'name' | 'checksum'>>): void
}

export const DATABASE_MIGRATION_TABLE = 'capacitylens_schema_migrations'

const MIGRATION_HISTORY_SQL = `
CREATE TABLE IF NOT EXISTS ${DATABASE_MIGRATION_TABLE} (
  version INTEGER NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK(length(checksum) = 64),
  appliedAt TEXT NOT NULL
) STRICT;
`

function defineMigration(
  version: number,
  name: string,
  definition: string,
  up: (db: Db) => void,
): DatabaseMigration {
  // The definition is the immutable, reviewable migration manifest. Include every SQL block and
  // named repair revision that contributes to the step. Once released, changing it changes the
  // checksum and every already-upgraded database will refuse to open instead of drifting silently.
  const checksum = createHash('sha256')
    .update('capacitylens-sqlite-migration\0')
    .update(String(version))
    .update('\0')
    .update(name)
    .update('\0')
    .update(definition)
    .digest('hex')
  return { version, name, checksum, up }
}

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

/** Open/configure the SQLite handle without creating or migrating application tables. Production
 * startup uses this seam to inspect the migration plan and take its rollback snapshot first. */
export function openDbConnection(path: string): Db {
  let db: Db
  try {
    db = new DatabaseSync(path, { enableForeignKeyConstraints: false, timeout: 5000 })
  } catch (e) {
    // Boot SHOULD crash on an unopenable DB — but frame the raw node:sqlite error with the path so
    // an operator sees "could not open <CAPACITYLENS_DB>" instead of a bare stack. Rethrow (don't swallow).
    throw new Error(
      `Could not open the SQLite database at "${path}": ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    )
  }
  if (path !== ':memory:') {
    try {
      chmodSync(path, 0o600)
      // WAL/SHM may not exist until the first write; the process umask above protects later files.
    } catch (cause) {
      db.close()
      throw new Error(`Could not restrict database permissions at "${path}".`, { cause })
    }
  }
  // Also set the pragma explicitly: constructor timeout is the primary Node 24 path; the pragma
  // pins the behavior if the driver construction path changes later.
  db.exec('PRAGMA busy_timeout = 5000;')
  return db
}

const pragmaNumber = (db: Db, pragma: 'user_version' | 'application_id'): number =>
  Number((db.prepare(`PRAGMA ${pragma}`).get() as Record<string, number | undefined>)[pragma] ?? 0)

const userTables = (db: Db): string[] =>
  (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{
    name: string
  }>).map((row) => row.name)

/** Read-only migration planning. It rejects future/wrong-application files before any schema DDL. */
export function planDatabaseMigrations(db: Db): DatabaseMigrationPlan {
  const fromVersion = pragmaNumber(db, 'user_version')
  const applicationId = pragmaNumber(db, 'application_id')
  const tables = userTables(db)
  const fresh = tables.length === 0

  if (!Number.isSafeInteger(fromVersion) || fromVersion < 0) {
    throw new Error(`Database schema version is invalid (${fromVersion}).`)
  }
  if (fromVersion > DB_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${fromVersion} is newer than this server supports (${DB_SCHEMA_VERSION}); refusing a downgrade.`,
    )
  }
  if (applicationId !== 0 && applicationId !== CAPACITYLENS_APPLICATION_ID) {
    throw new Error(
      `SQLite application_id ${applicationId} does not identify a CapacityLens database; refusing to modify this file.`,
    )
  }
  if (!fresh && applicationId === 0) {
    const legacyDomainTables = new Set([...Object.keys(TABLES), 'tasks'])
    const legacyShape = tables.includes('accounts') && tables.some(
      (table) => table !== 'accounts' && legacyDomainTables.has(table),
    )
    if (!legacyShape) {
      throw new Error('SQLite file has tables but no CapacityLens application_id or legacy CapacityLens shape; refusing to modify it.')
    }
  }
  if (fromVersion === DB_SCHEMA_VERSION && applicationId !== CAPACITYLENS_APPLICATION_ID) {
    throw new Error('Current-version database is missing the CapacityLens application_id; refusing ambiguous schema repair.')
  }
  assertMigrationHistory(db, fromVersion)

  return {
    fromVersion,
    toVersion: DB_SCHEMA_VERSION,
    fresh,
    migrations: DATABASE_MIGRATIONS.filter((migration) => migration.version > fromVersion).map(
      ({ version, name, checksum }) => ({ version, name, checksum }),
    ),
  }
}

const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  defineMigration(
    8,
    'establish-explicit-migration-baseline',
    [
      'legacy-activity-table-rename:v1',
      SCHEMA_V8_SQL,
      'legacy-schema-shape-repair:v1',
      'app-control-table-repair:v1',
      'initialization-marker-repair:v1',
      'internal-client-repair:v1',
      INTERNAL_CLIENT_UNIQUE_INDEX_SQL,
    ].join('\n-- migration component --\n'),
    (db) => {
      // Consolidate every legacy v0-v7 file through the already-proven, introspection-gated
      // repair path. From v8 onward, persisted changes get their own ordered migration entry.
      renameLegacyActivityTables(db)
      db.exec(SCHEMA_V8_SQL)
      migrateSchemaV8(db)
      ensureControlTables(db)
      if (!isInitialized(db) && !isEmpty(loadState(db))) markInitialized(db)
      ensureInternalClients(db)
      db.exec(INTERNAL_CLIENT_UNIQUE_INDEX_SQL)
      assertSchemaV8(db)
      assertControlTablesCurrent(db)
    },
  ),
  defineMigration(
    9,
    'add-internal-colour-mode',
    [
      'guard:PRAGMA table_info(accounts):internalColourMode-missing',
      'ALTER TABLE accounts ADD COLUMN internalColourMode TEXT;',
    ].join('\n'),
    (db) => {
      // Some pre-ledger development databases were manually version-stamped after receiving the
      // current optional-column repair. Keep the explicit migration idempotent for that shape while
      // real released v8 databases take the ALTER path.
      const exists = (db.prepare(`PRAGMA table_info(accounts)`).all() as Array<{ name: string }>)
        .some((column) => column.name === 'internalColourMode')
      if (!exists) db.exec('ALTER TABLE accounts ADD COLUMN internalColourMode TEXT;')
      assertSchemaCurrent(db)
    },
  ),
]

if (DATABASE_MIGRATIONS.at(-1)?.version !== DB_SCHEMA_VERSION) {
  throw new Error('DB_SCHEMA_VERSION must equal the newest explicit database migration.')
}
for (let index = 1; index < DATABASE_MIGRATIONS.length; index += 1) {
  if (DATABASE_MIGRATIONS[index].version !== DATABASE_MIGRATIONS[index - 1].version + 1) {
    throw new Error('Explicit database migration versions must be contiguous and ordered.')
  }
}

function migrationHistoryExists(db: Db): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(
    DATABASE_MIGRATION_TABLE,
  ) !== undefined
}

function assertMigrationHistoryTable(db: Db): void {
  const expected = new Map<string, { type: string; required: boolean }>([
    ['version', { type: 'INTEGER', required: true }],
    ['name', { type: 'TEXT', required: true }],
    ['checksum', { type: 'TEXT', required: true }],
    ['appliedAt', { type: 'TEXT', required: true }],
  ])
  const columns = db.prepare(`PRAGMA table_info(${DATABASE_MIGRATION_TABLE})`).all() as Array<{
    name: string
    type: string
    notnull: number
    pk: number
  }>
  const problems: string[] = []
  for (const column of columns) {
    const wanted = expected.get(column.name)
    if (!wanted) {
      problems.push(`unexpected column ${column.name}`)
      continue
    }
    if (column.type.toUpperCase() !== wanted.type) problems.push(`${column.name} has type ${column.type}`)
    if ((column.notnull === 1) !== wanted.required) problems.push(`${column.name} nullability mismatch`)
    if (column.name === 'version' && column.pk !== 1) problems.push('version is not the primary key')
  }
  for (const name of expected.keys()) {
    if (!columns.some((column) => column.name === name)) problems.push(`missing column ${name}`)
  }
  if (problems.length > 0) {
    throw new Error(`Database migration history table is invalid — ${problems.join('; ')}.`)
  }
}

/** Validate the database-side audit trail before planning any writes. Legacy v0-v7 files have no
 * history yet; v8 creates the table and its baseline row atomically with the schema/version stamp. */
function assertMigrationHistory(db: Db, databaseVersion: number): void {
  const exists = migrationHistoryExists(db)
  const expected = DATABASE_MIGRATIONS.filter((migration) => migration.version <= databaseVersion)
  if (!exists) {
    if (expected.length > 0) {
      throw new Error(
        `Database schema version ${databaseVersion} is missing its ${DATABASE_MIGRATION_TABLE} audit trail.`,
      )
    }
    return
  }

  assertMigrationHistoryTable(db)
  const rows = db.prepare(
    `SELECT version, name, checksum, appliedAt FROM ${DATABASE_MIGRATION_TABLE} ORDER BY version`,
  ).all() as Array<{ version: number; name: string; checksum: string; appliedAt: string }>
  if (rows.length !== expected.length) {
    throw new Error(
      `Database migration history has ${rows.length} row(s), expected ${expected.length} for schema version ${databaseVersion}.`,
    )
  }
  for (let index = 0; index < expected.length; index += 1) {
    const migration = expected[index]
    const row = rows[index]
    if (row.version !== migration.version) {
      throw new Error(`Database migration history is missing or out of order at version ${migration.version}.`)
    }
    if (row.name !== migration.name) {
      throw new Error(`Database migration v${migration.version} name does not match this build.`)
    }
    if (row.checksum !== migration.checksum) {
      throw new Error(`Database migration v${migration.version} checksum does not match this build.`)
    }
    if (!row.appliedAt) throw new Error(`Database migration v${migration.version} has no applied timestamp.`)
  }
}

/** Apply every pending migration and finish configuring an already-open handle. Each version step
 * owns one BEGIN IMMEDIATE transaction and advances user_version inside that same commit. */
export function initializeOpenDb(
  db: Db,
  path: string,
  hooks: DatabaseMigrationHooks = {},
): DatabaseMigrationPlan {
  const plan = planDatabaseMigrations(db)
  if (plan.migrations.length > 0 && !plan.fresh) {
    const quickCheck = db.prepare('PRAGMA quick_check').all() as Array<{ quick_check?: string }>
    if (quickCheck.length !== 1 || quickCheck[0]?.quick_check !== 'ok') {
      throw new Error(`Database quick integrity check failed before migration (${quickCheck.length} result row(s)).`)
    }
  }

  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const pending of plan.migrations) {
    const migration = DATABASE_MIGRATIONS.find((candidate) => candidate.version === pending.version)
    if (!migration) throw new Error(`Missing database migration implementation for v${pending.version}.`)
    tx(db, () => {
      db.exec(MIGRATION_HISTORY_SQL)
      assertMigrationHistoryTable(db)
      migration.up(db)
      const fkViolations = db.prepare('PRAGMA foreign_key_check').all()
      if (fkViolations.length > 0) {
        throw new Error(
          `Database migration v${migration.version} (${migration.name}) left ${fkViolations.length} foreign-key violation(s).`,
        )
      }
      db.prepare(
        `INSERT INTO ${DATABASE_MIGRATION_TABLE} (version, name, checksum, appliedAt) VALUES (?, ?, ?, ?)`,
      ).run(migration.version, migration.name, migration.checksum, new Date().toISOString())
      db.exec(`PRAGMA application_id = ${CAPACITYLENS_APPLICATION_ID}`)
      db.exec(`PRAGMA user_version = ${migration.version}`)
      hooks.beforeCommit?.({
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
      })
    }, 'immediate')
  }

  assertSchemaCurrent(db)
  assertControlTablesCurrent(db)
  assertMigrationHistory(db, DB_SCHEMA_VERSION)
  if (pragmaNumber(db, 'user_version') !== DB_SCHEMA_VERSION) {
    throw new Error(`Database migration did not reach expected version ${DB_SCHEMA_VERSION}.`)
  }
  if (pragmaNumber(db, 'application_id') !== CAPACITYLENS_APPLICATION_ID) {
    throw new Error('Database migration did not stamp the CapacityLens application_id.')
  }

  db.exec('PRAGMA foreign_keys = ON;')
  const fkViolations = db.prepare('PRAGMA foreign_key_check').all()
  if (fkViolations.length > 0) {
    throw new Error(`Database foreign-key integrity check failed (${fkViolations.length} violation(s)).`)
  }
  if (path !== ':memory:') {
    try {
      // Schema setup normally creates the WAL/SHM sidecars after the first chmod above. Pin every
      // file in the SQLite set before returning the live handle; process.umask(0077) protects any
      // sidecar SQLite later recreates in the server process.
      for (const file of [path, `${path}-wal`, `${path}-shm`]) {
        if (existsSync(file)) chmodSync(file, 0o600)
      }
    } catch (cause) {
      db.close()
      throw new Error(`Could not restrict SQLite file permissions at "${path}".`, { cause })
    }
  }
  return plan
}

/** Convenience open used by tests and embedded callers. The production entrypoint uses
 * openDbConnection → pre-migration snapshot → initializeOpenDb instead. */
export function openDb(path: string): Db {
  const db = openDbConnection(path)
  try {
    initializeOpenDb(db, path)
    return db
  } catch (error) {
    db.close()
    throw error
  }
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
 * PRIVATE-NAME PROJECTION: `opts.includePrivateNames` is REQUIRED. When false, private client and
 * project real names are replaced with their quoted code names and the raw `codeName` field is
 * removed. Only account owners pass true; every other role is narrowed before serialization.
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
 * @param opts.includePrivateNames REQUIRED. `true` keeps real private names; `false` substitutes
 *                                 quoted code names and strips the raw codeName field.
 * @param opts.includeInactive  REQUIRED. `false` drops archived/soft-deleted resources/clients/projects
 *                              (the normal app read); `true` returns every row (the P2.5 admin read).
 * @returns An AppData containing ONLY `accountId`'s data (every key present; arrays may be empty).
 */
export function readSlice(
  db: Db,
  accountId: string,
  opts: { includeTimeOffNote: boolean; includeInactive: boolean; includePrivateNames: boolean },
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
  // Private real names are owner-only. Replace them with the consistently quoted code name and
  // remove the raw codeName field before this slice can be serialized or cached by a non-owner.
  const visibleData = opts.includePrivateNames
    ? (data as unknown as AppData)
    : redactPrivateNames(data as unknown as AppData)
  // P2.4 lifecycle projection: for the NORMAL app read (includeInactive:false), drop every NON-active
  // (archived/soft-deleted) resource/client/project via the SHARED activeOnly helper — the SAME rule
  // the client views use (useActiveScopedData), so the two halves can't drift. Applied AFTER the note
  // redaction so the projection runs over the already-redacted slice. includeInactive:true (P2.5's
  // admin read) returns the full slice untouched. The dropped rows stay in the DB + export.
  if (!opts.includeInactive) return activeOnly(visibleData)
  return visibleData
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
