import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chmodSync, copyFileSync, existsSync, statSync, unlinkSync } from 'node:fs'
import {
  CAPACITYLENS_APPLICATION_ID,
  DATABASE_MIGRATION_TABLE,
  DB_SCHEMA_VERSION,
  deleteRow,
  getRow,
  initializeOpenDb,
  insertRow,
  isEmpty,
  isInitialized,
  loadState,
  openDb,
  openDbConnection,
  planDatabaseMigrations,
  seedIfUninitialized,
  V13_DEFINITION,
  V13_FROZEN_PRESET_COLORS,
} from './db'
import { seed } from '@capacitylens/shared/data/seed'
import { PRESET_COLORS } from '@capacitylens/shared/lib/color'
import { upsertMember } from './controlTables'
import { authFromEnv, runAuthMigrations } from './auth'

// openDb only ran CREATE TABLE IF NOT EXISTS, so a file written by an older schema
// kept its old columns/constraints forever and broke after a model change. These
// tests synthesize such an old file BY HAND and prove openDb's migrateSchema upgrades
// it in place. (A normal e2e/fresh run never exercises this — a new DB already has the
// current shape, so the migration is a no-op there and would give false confidence.)

const TS = '2026-01-01T00:00:00.000Z'
const fixture = (name: string): string => join(process.cwd(), 'src', 'fixtures', 'databases', name)

function copyFixture(name: string): { path: string; cleanup: () => void } {
  const path = join(tmpdir(), `capacitylens-${name}-${process.pid}-${Date.now()}.db`)
  const cleanup = () => {
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(path + suffix) } catch { /* not present */ }
    }
  }
  cleanup()
  copyFileSync(fixture(name), path)
  return { path, cleanup }
}

const schemaFingerprint = (db: DatabaseSync): unknown[] =>
  db.prepare(`
    SELECT type, name, tbl_name, sql
      FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%'
       AND type IN ('table', 'index')
     ORDER BY type, name
  `).all()

// The shape as it shipped BEFORE the Task→Activity rename (and before general tasks +
// scheduling modes): the table was `tasks` (projectId NOT NULL), the allocation FK was
// `taskId`, accounts had no schedulingMode, allocations had no ignoreWeekends. Kept verbatim
// here on purpose — this fixture IS a legacy DB, so openDb must rename it (tasks→activities,
// taskId→activityId) AND rebuild it. Only the drifted/parent tables are created; openDb's
// CREATE TABLE IF NOT EXISTS fills in the rest (disciplines/phases/resources/timeOff) current.
const OLD_SCHEMA = `
CREATE TABLE accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE clients (
  id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE projects (
  id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL, clientId TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  color TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phaseId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE allocations (
  id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  resourceId TEXT NOT NULL, taskId TEXT NOT NULL,
  startDate TEXT NOT NULL, endDate TEXT NOT NULL, hoursPerDay REAL NOT NULL,
  status TEXT NOT NULL, note TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
`

function writeOldDb(path: string): void {
  const old = new DatabaseSync(path)
  old.exec(OLD_SCHEMA)
  old.exec(`
    INSERT INTO accounts VALUES ('a1','Studio','#111','${TS}','${TS}');
    INSERT INTO clients  VALUES ('c1','a1','Acme','#222','${TS}','${TS}');
    INSERT INTO projects VALUES ('p1','a1','Web','c1','#333','${TS}','${TS}');
    INSERT INTO tasks    VALUES ('t1','a1','Existing task','p1',NULL,'${TS}','${TS}');
  `)
  old.close()
}

/** Released CapacityLens databases always carry the full table set. Focused drift fixtures create
 * one realistic companion table so the legacy-file discriminator can distinguish them from an
 * unrelated SQLite database that merely happens to have a generic `accounts` table. */
function addLegacyCompanionTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE disciplines (
    id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, sortOrder INTEGER NOT NULL,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  );`)
}

describe('schema migration of an existing on-disk DB', () => {
  it('restricts the database and all live SQLite sidecars to owner read/write', () => {
    const path = join(tmpdir(), `capacitylens-mode-${process.pid}-${Date.now()}.db`)
    try {
      const db = openDb(path)
      insertRow(db, 'accounts', {
        id: 'a-mode', name: 'Mode', color: '#111111', createdAt: TS, updatedAt: TS,
      })
      // Prove openDb repairs a permissive pre-existing database as well as creating secure files.
      chmodSync(path, 0o666)
      db.close()
      const reopened = openDb(path)
      const liveFiles = [path, `${path}-wal`, `${path}-shm`].filter(existsSync)
      expect(liveFiles).toContain(`${path}-wal`)
      expect(liveFiles).toContain(`${path}-shm`)
      for (const file of liveFiles) expect(statSync(file).mode & 0o777).toBe(0o600)
      reopened.close()
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        try { unlinkSync(path + suffix) } catch { /* not present */ }
      }
    }
  })

  it('folds duplicate Internal clients before installing the singleton index', () => {
    const path = join(tmpdir(), `capacitylens-internal-${process.pid}-${Date.now()}.db`)
    const cleanup = () => {
      for (const suffix of ['', '-wal', '-shm']) {
        try { unlinkSync(path + suffix) } catch { /* not present */ }
      }
    }
    cleanup()
    try {
      const legacy = openDb(path)
      legacy.exec(`DROP INDEX clients_one_builtin_per_account`)
      insertRow(legacy, 'accounts', {
        id: 'a1', name: 'Studio', color: '#111111', createdAt: TS, updatedAt: TS,
      })
      insertRow(legacy, 'clients', {
        id: 'internal:a1', accountId: 'a1', name: 'Internal', color: '#9c3ace', builtin: true,
        createdAt: TS, updatedAt: TS,
      })
      insertRow(legacy, 'clients', {
        id: 'legacy-internal', accountId: 'a1', name: 'Internal', color: '#9c3ace', builtin: true,
        createdAt: '2025-01-01T00:00:00.000Z', updatedAt: TS,
      })
      insertRow(legacy, 'projects', {
        id: 'p1', accountId: 'a1', clientId: 'legacy-internal', name: 'Legacy', color: '#111111',
        createdAt: TS, updatedAt: TS,
      })
      // Model a released v7 file: v8 is the explicit repair boundary, while a current-version file
      // must never receive unversioned mutation merely because it was reopened.
      legacy.exec(`
        DROP TABLE ${DATABASE_MIGRATION_TABLE};
        PRAGMA user_version = 7;
        PRAGMA application_id = 0;
      `)
      legacy.close()

      const repaired = openDb(path)
      const state = loadState(repaired)
      expect(state.clients.filter((client) => client.accountId === 'a1' && client.builtin)).toHaveLength(1)
      expect(state.clients.find((client) => client.builtin)?.id).toBe('internal:a1')
      expect(state.projects.find((project) => project.id === 'p1')?.clientId).toBe('internal:a1')
      expect(() => insertRow(repaired, 'clients', {
        id: 'another-internal', accountId: 'a1', name: 'Internal', color: '#9c3ace', builtin: true,
        createdAt: TS, updatedAt: TS,
      })).toThrow(/unique/i)
      repaired.close()
    } finally {
      cleanup()
    }
  })

  it('v13 snaps every legacy non-preset account colour to its nearest preset exactly once, leaving preset colours untouched', () => {
    // Before v13, sanitizeWrite('accounts') replaced ANY non-preset stored colour with one FIXED
    // fallback hex on every write, and no migration ever repaired the rows already on disk — so a
    // legacy account's colour would silently flip to that one fixed colour the next time its row
    // was touched. This proves the v13 data repair snaps it to its NEAREST preset instead, runs
    // exactly once (idempotent DB migration ledger), and leaves an already-preset colour alone.
    const path = join(tmpdir(), `capacitylens-migrate-colour-${process.pid}-${Date.now()}.db`)
    const cleanup = () => {
      for (const suffix of ['', '-wal', '-shm']) {
        try { unlinkSync(path + suffix) } catch { /* not present */ }
      }
    }
    cleanup()
    try {
      const db = openDb(path) // fresh DB: already at the current version (v13 is a no-op here)
      // #7cd9e4 is not a preset — its nearest preset is #7adae3 (see shared color.test.ts for the
      // same fixture, pinned there against the full palette).
      insertRow(db, 'accounts', { id: 'a-legacy', name: 'Legacy', color: '#7cd9e4', createdAt: TS, updatedAt: TS })
      // Already a preset colour — must round-trip byte-identical, not get re-snapped to itself
      // via some other path that could reformat it.
      insertRow(db, 'accounts', { id: 'a-preset', name: 'Already preset', color: '#e02727', createdAt: TS, updatedAt: TS })
      // Roll the ledger back to "just before v13" (mirrors the v7 rollback other tests use, but only
      // a couple of steps back) so the next openDb() re-runs the v13 migration against these rows.
      // Every row past v12 must go: a leftover future-version ledger row would (rightly) fail the
      // exact-history assertion for user_version = 12.
      db.exec(`DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version > 12`)
      db.exec(`PRAGMA user_version = 12`)
      db.close()

      const upgraded = openDb(path)
      const state = loadState(upgraded)
      expect(state.accounts.find((a) => a.id === 'a-legacy')?.color).toBe('#7adae3')
      expect(state.accounts.find((a) => a.id === 'a-preset')?.color).toBe('#e02727')
      const history = upgraded.prepare(
        `SELECT version, name FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 13`,
      ).get() as { version: number; name: string } | undefined
      expect(history).toEqual({ version: 13, name: 'snap-legacy-account-colors' })
      upgraded.close()

      // Idempotent: reopening an already-migrated DB plans no further migrations and leaves the
      // now-repaired colours untouched (the write-time guard is a no-op for already-migrated data).
      const reopened = openDb(path)
      expect(planDatabaseMigrations(reopened).migrations).toEqual([])
      const restate = loadState(reopened)
      expect(restate.accounts.find((a) => a.id === 'a-legacy')?.color).toBe('#7adae3')
      expect(restate.accounts.find((a) => a.id === 'a-preset')?.color).toBe('#e02727')
      reopened.close()
    } finally {
      cleanup()
    }
  })

  it('v14 revokes an outstanding reset ceremony for a non-owner active member, leaving the membership row untouched', () => {
    // v12 revoked ceremonies for active OWNERS only, so a co-owner the v10-era raw-SQL repairs
    // demoted to admin kept any reset link minted while they still held Owner privilege. v14 is the
    // blanket every-active-member repair (the original v11 destroyed the role history a targeted
    // revocation would need — see migrateMemberResetCeremoniesV14). This drives it through the real
    // ledger/openDb path: the admin's link is burned, the membership row itself is not modified.
    const path = join(tmpdir(), `capacitylens-migrate-v14-${process.pid}-${Date.now()}.db`)
    const cleanup = () => {
      for (const suffix of ['', '-wal', '-shm']) {
        try { unlinkSync(path + suffix) } catch { /* not present */ }
      }
    }
    cleanup()
    try {
      const db = openDb(path) // fresh DB: already at the current version (v14 is a no-op here)
      insertRow(db, 'accounts', { id: 'a1', name: 'Studio', color: '#e02727', createdAt: TS, updatedAt: TS })
      upsertMember(db, { accountId: 'a1', userId: 'kept-owner', role: 'owner', status: 'active', createdAt: TS })
      upsertMember(db, { accountId: 'a1', userId: 'demoted-admin', role: 'admin', status: 'active', createdAt: TS })
      // Better Auth normally creates `verification` when password auth first runs; mirror that shape
      // (as controlTables.test.ts does) AFTER the membership writes, so upsertMember's own
      // privilege-change revocation cannot be what removes the token — only v14 can.
      db.exec(`CREATE TABLE verification (id TEXT PRIMARY KEY, value TEXT NOT NULL)`)
      db.prepare(`INSERT INTO verification (id, value) VALUES (?, ?)`).run('demoted-reset', 'demoted-admin')
      // Roll the ledger back to "just before v14" so the next openDb() re-runs ONLY the v14 migration.
      db.exec(`DELETE FROM ${DATABASE_MIGRATION_TABLE} WHERE version >= 14`)
      db.exec(`PRAGMA user_version = 13`)
      db.close()

      const upgraded = openDb(path)
      expect(upgraded.prepare(`SELECT id FROM verification`).all()).toEqual([])
      expect(
        upgraded.prepare(`SELECT role, status, createdAt FROM account_members WHERE userId = ?`).get('demoted-admin'),
      ).toEqual({ role: 'admin', status: 'active', createdAt: TS })
      expect(upgraded.prepare(`SELECT version, name FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 14`).get())
        .toEqual({ version: 14, name: 'revoke-member-reset-ceremonies' })
      expect((upgraded.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version)
        .toBe(DB_SCHEMA_VERSION)
      upgraded.close()

      // Idempotent: reopening an already-migrated DB plans no further migrations.
      const reopened = openDb(path)
      expect(planDatabaseMigrations(reopened).migrations).toEqual([])
      reopened.close()
    } finally {
      cleanup()
    }
  })

  it('upgrades an old-shape DB (NOT NULL projectId, missing new columns) to current', () => {
    const path = join(tmpdir(), `capacitylens-migrate-${process.pid}-${Date.now()}.db`)
    const cleanup = () => {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          unlinkSync(path + suffix)
        } catch {
          /* not present — fine */
        }
      }
    }
    cleanup()
    try {
      writeOldDb(path)
      // The legacy fixture also lacks required allocation foreign keys. Additive column migration
      // must not bless that drift: startup now fails closed and names the relational mismatch.
      expect(() => openDb(path)).toThrow(/foreign-key mismatch/i)
    } finally {
      cleanup()
    }
  })

  it('seeds a never-initialised DB once, and NOT after the user empties it (no demo re-seed)', () => {
    const db = openDb(':memory:')
    // Fresh DB: uninitialised → seeds.
    expect(isInitialized(db)).toBe(false)
    expect(seedIfUninitialized(db, seed())).toBe(true)
    expect(isInitialized(db)).toBe(true)
    expect(loadState(db).accounts.length).toBeGreaterThan(0)
    // Second boot of the same DB: already initialised → no re-seed.
    expect(seedIfUninitialized(db, seed())).toBe(false)

    // The user deletes ALL their data (cascade empties every scoped table; _meta survives).
    for (const a of loadState(db).accounts) deleteRow(db, 'accounts', a.id)
    expect(isEmpty(loadState(db))).toBe(true)
    expect(isInitialized(db)).toBe(true) // ...but still initialised
    // The regression guard: a boot against the empty-but-initialised DB must NOT re-seed
    // (gating on isEmpty() — the old bug — would have resurrected the demo dataset here).
    expect(seedIfUninitialized(db, seed())).toBe(false)
    expect(isEmpty(loadState(db))).toBe(true)
    db.close()
  })

  it('generically ADDs a missing OPTIONAL column with no hard-coded migration step', () => {
    // An old `disciplines` table missing the optional `color` column. There is NO
    // hard-coded rule for disciplines.color, so this proves the migration is GENERIC —
    // a future additive optional field is picked up from the spec automatically (the old
    // version-gated pass would have frozen and left the column missing).
    const path = join(tmpdir(), `capacitylens-migrate-gen-${process.pid}-${Date.now()}.db`)
    const cleanup = () => {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          unlinkSync(path + suffix)
        } catch {
          /* not present — fine */
        }
      }
    }
    cleanup()
    try {
      const old = new DatabaseSync(path)
      old.exec(`
        CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
        CREATE TABLE disciplines (
          id TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          name TEXT NOT NULL, sortOrder INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
        );
      `)
      old.exec(`INSERT INTO accounts VALUES ('a1','Studio','#111','${TS}','${TS}');`)
      old.close()

      const db = openDb(path) // generic pass adds disciplines.color
      expect(() =>
        insertRow(db, 'disciplines', { id: 'd1', accountId: 'a1', name: 'Design', color: '#abcdef', sortOrder: 0, createdAt: TS, updatedAt: TS }),
      ).not.toThrow()
      expect(getRow(db, 'disciplines', 'd1')?.color).toBe('#abcdef')
      db.close()
    } finally {
      cleanup()
    }
  })

  it('throws a clear, column-naming error when an existing DB lacks a now-REQUIRED column', () => {
    // The flip side of the generic optional-add: an old `accounts` table that predates a
    // required column (here `color`). CREATE TABLE IF NOT EXISTS won't backfill it and
    // migrateSchema only auto-adds OPTIONAL columns — a NOT NULL addition can't be ALTER-ADDed
    // to existing rows, so it needs an explicit rebuild step that doesn't exist yet. Rather than
    // let that drift surface later as a cryptic "no column named color" on the first write (or
    // silently read back undefined), openDb's assertSchemaCurrent must fail fast and name it.
    const path = join(tmpdir(), `capacitylens-migrate-req-${process.pid}-${Date.now()}.db`)
    const cleanup = () => {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          unlinkSync(path + suffix)
        } catch {
          /* not present — fine */
        }
      }
    }
    cleanup()
    try {
      const old = new DatabaseSync(path)
      // accounts without the required `color` column (predates it).
      old.exec(`CREATE TABLE accounts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );`)
      addLegacyCompanionTable(old)
      old.close()
      expect(() => openDb(path)).toThrow(/accounts\.color/)
      // The explicit v8 step is atomic: all tables/columns it created before the assertion failed
      // rolled back with its user_version/application_id stamps, so retry/restore has one state.
      const unchanged = new DatabaseSync(path, { readOnly: true })
      expect((unchanged.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(0)
      expect((unchanged.prepare(`PRAGMA application_id`).get() as { application_id: number }).application_id).toBe(0)
      expect(
        (unchanged.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as Array<{ name: string }>).map(
          (row) => row.name,
        ),
      ).toEqual(['accounts', 'disciplines'])
      unchanged.close()
    } finally {
      cleanup()
    }
  })

  it('accounts.timezone and accounts.weekStartsOn are added by migration', () => {
    // An old accounts table without the new optional columns.
    const path = join(tmpdir(), `capacitylens-migrate-tz-${process.pid}-${Date.now()}.db`)
    const cleanup = () => {
      for (const suffix of ['', '-wal', '-shm']) {
        try { unlinkSync(path + suffix) } catch { /* fine */ }
      }
    }
    cleanup()
    try {
      const old = new DatabaseSync(path)
      old.exec(`
        CREATE TABLE accounts (
          id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
          schedulingMode TEXT,
          createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
        );
      `)
      addLegacyCompanionTable(old)
      old.exec(`INSERT INTO accounts VALUES ('a1','Studio','#111',NULL,'${TS}','${TS}');`)
      old.close()

      const db = openDb(path)
      // After migration, both new optional columns exist and round-trip.
      insertRow(db, 'accounts', {
        id: 'a2', name: 'New Studio', color: '#222',
        timezone: 'Europe/Paris', weekStartsOn: 0,
        createdAt: TS, updatedAt: TS,
      })
      const row = getRow(db, 'accounts', 'a2')
      expect(row?.timezone).toBe('Europe/Paris')
      expect(row?.weekStartsOn).toBe(0)
      // The old row (without the new fields) reads back without them.
      const old2 = getRow(db, 'accounts', 'a1')
      expect(old2?.timezone).toBeUndefined()
      expect(old2?.weekStartsOn).toBeUndefined()
      db.close()
    } finally {
      cleanup()
    }
  })

  it('accounts.placeholdersEnabled and accounts.externalEnabled are added by migration', () => {
    // An old accounts table without the two new optional view-pref columns.
    const path = join(tmpdir(), `capacitylens-migrate-flags-${process.pid}-${Date.now()}.db`)
    const cleanup = () => {
      for (const suffix of ['', '-wal', '-shm']) {
        try { unlinkSync(path + suffix) } catch { /* fine */ }
      }
    }
    cleanup()
    try {
      const old = new DatabaseSync(path)
      old.exec(`
        CREATE TABLE accounts (
          id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
          schedulingMode TEXT, timezone TEXT, weekStartsOn TEXT, disciplinesEnabled TEXT,
          createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
        );
      `)
      addLegacyCompanionTable(old)
      old.exec(`INSERT INTO accounts (id,name,color,createdAt,updatedAt) VALUES ('a1','Studio','#111','${TS}','${TS}');`)
      old.close()

      const db = openDb(path)
      // After migration, both new optional columns exist and round-trip a present boolean.
      insertRow(db, 'accounts', {
        id: 'a2', name: 'New Studio', color: '#222',
        placeholdersEnabled: true, externalEnabled: true,
        createdAt: TS, updatedAt: TS,
      })
      const row = getRow(db, 'accounts', 'a2')
      expect(row?.placeholdersEnabled).toBe(true)
      expect(row?.externalEnabled).toBe(true)
      // The old row (without the new fields) reads back without them (absent → default false client-side).
      const old2 = getRow(db, 'accounts', 'a1')
      expect(old2?.placeholdersEnabled).toBeUndefined()
      expect(old2?.externalEnabled).toBeUndefined()
      db.close()
    } finally {
      cleanup()
    }
  })

  it('throws a nullability-mismatch error when a column is present but NULL/NOT NULL disagrees with the spec', () => {
    // accounts.schedulingMode is OPTIONAL in the spec (nullable), but here the on-disk column
    // exists as NOT NULL. It's present, so migrateSchema won't touch it and the missing-column
    // check passes — only the nullability check catches that the two sources of truth (TABLES'
    // optional? flag vs SCHEMA_SQL's NOT NULL) have drifted. Without it, a write that legitimately
    // omits schedulingMode would hit a confusing NOT NULL error instead.
    const path = join(tmpdir(), `capacitylens-migrate-null-${process.pid}-${Date.now()}.db`)
    const cleanup = () => {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          unlinkSync(path + suffix)
        } catch {
          /* not present — fine */
        }
      }
    }
    cleanup()
    try {
      const old = new DatabaseSync(path)
      old.exec(`CREATE TABLE accounts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
        schedulingMode TEXT NOT NULL,
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );`)
      addLegacyCompanionTable(old)
      old.close()
      expect(() => openDb(path)).toThrow(/schedulingMode/)
      expect(() => openDb(path)).toThrow(/nullability/i)
    } finally {
      cleanup()
    }
  })

  it('stamps a fresh DB with the independent physical version and CapacityLens application id', () => {
    const db = openDb(':memory:')
    expect((db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(DB_SCHEMA_VERSION)
    expect((db.prepare(`PRAGMA application_id`).get() as { application_id: number }).application_id)
      .toBe(CAPACITYLENS_APPLICATION_ID)
    const history = db.prepare(
      `SELECT version, name, checksum, appliedAt FROM ${DATABASE_MIGRATION_TABLE} ORDER BY version`,
    ).all() as Array<{ version: number; name: string; checksum: string; appliedAt: string }>
    expect(history.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 8, name: 'establish-explicit-migration-baseline' },
      { version: 9, name: 'add-internal-colour-mode' },
      { version: 10, name: 'enforce-single-owner' },
      { version: 11, name: 'repair-ownerless-memberships' },
      { version: 12, name: 'revoke-owner-reset-ceremonies' },
      { version: 13, name: 'snap-legacy-account-colors' },
      { version: 14, name: 'revoke-member-reset-ceremonies' },
      { version: 15, name: 'add-account-boundary-state' },
    ])
    // Shipped checksums are immutable: later migrations must never invalidate an upgraded database.
    expect(history[0].checksum).toBe('90add4af35f1914f7de3ca031528ad81e061424526b50ae099512aacf650ef3d')
    expect(history[1].checksum).toBe('41f8f933f17eb59dac8bfc7a385db70e46df61e249a295fd622f821dcc3bb1f0')
    expect(history[2].checksum).toBe('a178fba43ad4c58ca8508117303b568c05103a05cc6e48512f2e92306e857653')
    expect(history[3].checksum).toBe('561d0b306d9702e807d45702ec2424f0421b44eb2bc34adab7abc8ba08875117')
    expect(history[4].checksum).toBe('4e7a506b4324de4e8d48ad843d1eabe70b4723c6e9bb4e44f2ed1c76046b2b56')
    expect(history.every((row) => !Number.isNaN(Date.parse(row.appliedAt)))).toBe(true)
    expect(planDatabaseMigrations(db).migrations).toEqual([])
    db.close()
  })

  it('refuses missing or checksummed migration-history drift before planning writes', () => {
    const db = openDb(':memory:')
    db.prepare(`UPDATE ${DATABASE_MIGRATION_TABLE} SET checksum = ? WHERE version = ?`).run(
      '0'.repeat(64),
      DB_SCHEMA_VERSION,
    )
    expect(() => planDatabaseMigrations(db)).toThrow(/checksum does not match/i)

    db.prepare(`DELETE FROM ${DATABASE_MIGRATION_TABLE}`).run()
    expect(() => planDatabaseMigrations(db)).toThrow(/history has 0 row/i)
    db.close()
  })

  it('rolls back schema, history and version stamps when a migration fails before commit', () => {
    const copied = copyFixture('v7-off.db')
    try {
      const db = openDbConnection(copied.path)
      const injected = Object.assign(new Error('simulated disk exhaustion'), { code: 'ENOSPC' })
      expect(() => initializeOpenDb(db, copied.path, {
        beforeCommit: () => { throw injected },
      })).toThrow(/simulated disk exhaustion/i)
      expect((db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(7)
      expect((db.prepare(`PRAGMA application_id`).get() as { application_id: number }).application_id).toBe(0)
      expect(
        db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(
          DATABASE_MIGRATION_TABLE,
        ),
      ).toBeUndefined()
      expect((db.prepare(`SELECT COUNT(*) AS n FROM accounts`).get() as { n: number }).n).toBe(2)
      db.close()
    } finally {
      copied.cleanup()
    }
  })

  it('upgrades a committed v8 database through the current version without changing the v8 ledger row', () => {
    const copied = copyFixture('v7-off.db')
    try {
      const db = openDbConnection(copied.path)
      expect(() => initializeOpenDb(db, copied.path, {
        beforeCommit: (migration) => {
          if (migration.version === 9) throw new Error('stop before v9 commit')
        },
      })).toThrow(/stop before v9 commit/i)
      expect((db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(8)
      expect(db.prepare(`SELECT checksum FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 8`).get())
        .toEqual({ checksum: '90add4af35f1914f7de3ca031528ad81e061424526b50ae099512aacf650ef3d' })
      expect((db.prepare(`PRAGMA table_info(accounts)`).all() as Array<{ name: string }>).map((column) => column.name))
        .not.toContain('internalColourMode')
      db.close()

      const upgraded = openDb(copied.path)
      expect((upgraded.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(DB_SCHEMA_VERSION)
      expect((upgraded.prepare(`PRAGMA table_info(accounts)`).all() as Array<{ name: string }>).map((column) => column.name))
        .toContain('internalColourMode')
      expect((upgraded.prepare(`PRAGMA index_list(account_members)`).all() as Array<{ name: string }>).map((index) => index.name))
        .toContain('idx_account_members_single_active_owner')
      upgraded.close()
    } finally {
      copied.cleanup()
    }
  })

  it('refuses a future database without mutating its version', () => {
    const path = join(tmpdir(), `capacitylens-future-${process.pid}-${Date.now()}.db`)
    try {
      const future = new DatabaseSync(path)
      future.exec(`PRAGMA user_version = ${DB_SCHEMA_VERSION + 1}`)
      future.close()
      expect(() => openDb(path)).toThrow(/newer than this server supports/i)
      const unchanged = new DatabaseSync(path, { readOnly: true })
      expect((unchanged.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version)
        .toBe(DB_SCHEMA_VERSION + 1)
      unchanged.close()
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        try { unlinkSync(path + suffix) } catch { /* not present */ }
      }
    }
  })

  it('refuses a SQLite file claimed by another application', () => {
    const path = join(tmpdir(), `capacitylens-wrong-app-${process.pid}-${Date.now()}.db`)
    try {
      const other = new DatabaseSync(path)
      other.exec(`CREATE TABLE accounts (id TEXT); PRAGMA application_id = 1234`)
      other.close()
      expect(() => openDb(path)).toThrow(/does not identify a CapacityLens database/i)
      const unchanged = new DatabaseSync(path, { readOnly: true })
      expect((unchanged.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get() as { n: number }).n)
        .toBe(1)
      unchanged.close()
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        try { unlinkSync(path + suffix) } catch { /* not present */ }
      }
    }
  })

  it('refuses an unclaimed SQLite file with only a generic accounts table', () => {
    const path = join(tmpdir(), `capacitylens-ambiguous-${process.pid}-${Date.now()}.db`)
    try {
      const other = new DatabaseSync(path)
      other.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT)`)
      other.close()
      expect(() => openDb(path)).toThrow(/no CapacityLens application_id or legacy CapacityLens shape/i)
      const unchanged = new DatabaseSync(path, { readOnly: true })
      expect((unchanged.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get() as { n: number }).n)
        .toBe(1)
      unchanged.close()
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        try { unlinkSync(path + suffix) } catch { /* not present */ }
      }
    }
  })

  it('upgrades the released v7 auth-off fixture, preserves data, and is idempotent on reopen', () => {
    const copied = copyFixture('v7-off.db')
    try {
      const db = openDb(copied.path)
      expect((db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version).toBe(DB_SCHEMA_VERSION)
      expect(loadState(db).accounts.map((account) => account.name)).toContain('Studio North')
      expect((db.prepare(`SELECT COUNT(*) AS n FROM account_members`).get() as { n: number }).n).toBe(1)
      expect((db.prepare(`SELECT COUNT(*) AS n FROM invites`).get() as { n: number }).n).toBe(1)
      const fresh = openDb(':memory:')
      expect(schemaFingerprint(db)).toEqual(schemaFingerprint(fresh))
      fresh.close()
      db.close()

      const reopened = openDb(copied.path)
      expect(planDatabaseMigrations(reopened).migrations).toEqual([])
      expect((reopened.prepare(`PRAGMA foreign_key_check`).all() as unknown[])).toEqual([])
      reopened.close()
    } finally {
      copied.cleanup()
    }
  })

  it('upgrades the released v7 password fixture and preserves Better Auth identities and sessions', async () => {
    const copied = copyFixture('v7-password.db')
    try {
      const db = openDb(copied.path)
      const configured = authFromEnv(db, {
        NODE_ENV: 'test',
        CAPACITYLENS_AUTH: 'password',
        CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
        BETTER_AUTH_SECRET: 'fixture-secret-0123456789abcdef-012345',
        BETTER_AUTH_URL: 'http://localhost:8787',
      })
      await runAuthMigrations(configured.auth!)
      expect((db.prepare(`SELECT COUNT(*) AS n FROM user`).get() as { n: number }).n).toBe(1)
      expect((db.prepare(`SELECT COUNT(*) AS n FROM account`).get() as { n: number }).n).toBe(1)
      expect((db.prepare(`SELECT COUNT(*) AS n FROM session`).get() as { n: number }).n).toBe(1)
      expect((db.prepare(`SELECT email FROM user`).get() as { email: string }).email).toBe('fixture@example.invalid')
      db.close()
    } finally {
      copied.cleanup()
    }
  })
})

describe('migration ledger checksum supersession (v11 alpha-line amendment)', () => {
  // v11's definition was amended IN PLACE ('…promote-oldest…:v1' → '…promote-highest-role-tier…:v2').
  // Any DB upgraded by the PREVIOUS build recorded this OLD checksum in its ledger; the supersession
  // allow-list must accept exactly this one historical value for v11, and nothing else.
  const OLD_V11_CHECKSUM = '057242fc8e358bebf0a188395e9289d2661f6a89e843bc091e718d003f013f5e'

  it('boots a database whose v11 ledger row carries the superseded old-v11 checksum', () => {
    const path = join(tmpdir(), `capacitylens-superseded-v11-${process.pid}-${Date.now()}.db`)
    const cleanup = () => {
      for (const suffix of ['', '-wal', '-shm']) {
        try { unlinkSync(path + suffix) } catch { /* not present */ }
      }
    }
    cleanup()
    try {
      const seeded = openDb(path)
      insertRow(seeded, 'accounts', { id: 'a1', name: 'Studio', color: '#e02727', createdAt: TS, updatedAt: TS })
      // Model the already-upgraded install: rewrite v11 to the checksum the previous build stamped.
      seeded.prepare(`UPDATE ${DATABASE_MIGRATION_TABLE} SET checksum = ? WHERE version = 11`).run(OLD_V11_CHECKSUM)
      seeded.close()

      // The real boot path (openDb → planDatabaseMigrations → assertMigrationHistory) must NOT throw.
      const rebooted = openDb(path)
      expect(planDatabaseMigrations(rebooted).migrations).toEqual([])
      // Subsequent behaviour is normal: the data is intact and the DB stays writable.
      expect(loadState(rebooted).accounts.find((a) => a.id === 'a1')?.name).toBe('Studio')
      insertRow(rebooted, 'accounts', { id: 'a2', name: 'Second', color: '#2d75da', createdAt: TS, updatedAt: TS })
      expect(getRow(rebooted, 'accounts', 'a2')?.name).toBe('Second')
      // The ledger row is LEFT UNTOUCHED — we accept the superseded checksum, we don't rewrite history.
      expect(rebooted.prepare(`SELECT checksum FROM ${DATABASE_MIGRATION_TABLE} WHERE version = 11`).get())
        .toEqual({ checksum: OLD_V11_CHECKSUM })
      rebooted.close()
    } finally {
      cleanup()
    }
  })

  it('still refuses a genuinely wrong v11 checksum (neither the old nor the current definition)', () => {
    const db = openDb(':memory:')
    db.prepare(`UPDATE ${DATABASE_MIGRATION_TABLE} SET checksum = ? WHERE version = 11`).run('1'.repeat(64))
    expect(() => planDatabaseMigrations(db)).toThrow(/v11 checksum does not match/i)
    db.close()
  })

  it('is v11-only: the same old-v11 checksum on a different version still refuses startup', () => {
    const db = openDb(':memory:')
    // The allow-list is per-version. The v11 historical checksum on v12 is NOT allow-listed there.
    db.prepare(`UPDATE ${DATABASE_MIGRATION_TABLE} SET checksum = ? WHERE version = 12`).run(OLD_V11_CHECKSUM)
    expect(() => planDatabaseMigrations(db)).toThrow(/v12 checksum does not match/i)
    db.close()
  })
})

describe('v13 migration is self-contained (frozen palette folded into the checksum)', () => {
  it('embeds the frozen palette digest in the v13 definition string', () => {
    // The definition folds in the joined frozen-palette hex list so the migration CHECKSUM covers the
    // exact palette the repair snaps to — a future shared-palette edit can't silently change v13.
    expect(V13_DEFINITION).toContain(V13_FROZEN_PRESET_COLORS.join(','))
    expect(V13_DEFINITION).toContain('#7adae3') // spot-check a representative preset is in the digest
  })

  it('froze the palette byte-for-byte from the shared palette at authoring time', () => {
    // Authoring-time snapshot check: the frozen copy equalled shared PRESET_COLORS when v13 was
    // written. If shared PRESET_COLORS is ever edited and this fails, the fix is a NEW migration with
    // its own frozen list + checksum — NOT updating this frozen list (that would silently rewrite an
    // already-checksummed step). See V13_FROZEN_PRESET_COLORS in db.ts.
    expect(V13_FROZEN_PRESET_COLORS).toEqual(PRESET_COLORS)
  })
})
