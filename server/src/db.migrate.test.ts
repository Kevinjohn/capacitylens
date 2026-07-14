import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync } from 'node:fs'
import { openDb, insertRow, getRow, loadState, seedIfUninitialized, isInitialized, isEmpty, deleteRow } from './db'
import { seed } from '@capacitylens/shared/data/seed'

// openDb only ran CREATE TABLE IF NOT EXISTS, so a file written by an older schema
// kept its old columns/constraints forever and broke after a model change. These
// tests synthesize such an old file BY HAND and prove openDb's migrateSchema upgrades
// it in place. (A normal e2e/fresh run never exercises this — a new DB already has the
// current shape, so the migration is a no-op there and would give false confidence.)

const TS = '2026-01-01T00:00:00.000Z'

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

describe('schema migration of an existing on-disk DB', () => {
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
      old.close()
      expect(() => openDb(path)).toThrow(/accounts\.color/)
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
      old.close()
      expect(() => openDb(path)).toThrow(/schedulingMode/)
      expect(() => openDb(path)).toThrow(/nullability/i)
    } finally {
      cleanup()
    }
  })
})
