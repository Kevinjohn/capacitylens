import { describe, expect, it } from 'vitest'
import { getRow, insertRow, isInitialized, openDb, upsertRow } from './db'
import { tx } from './txn'

const TS = '2026-07-26T00:00:00.000Z'

const account = (name: string) => ({
  id: 'account-atomicity',
  name,
  color: '#2d75da',
  createdAt: TS,
  updatedAt: TS,
})

function failInitializationMarker(db: ReturnType<typeof openDb>): void {
  db.exec(`
    CREATE TRIGGER fail_initialization_marker
    BEFORE INSERT ON _meta
    WHEN NEW.key = 'initialized'
    BEGIN
      SELECT RAISE(ABORT, 'simulated meta failure');
    END;
  `)
}

describe('single-row write atomicity', () => {
  it('rolls back an inserted entity when the initialization marker fails', () => {
    const db = openDb(':memory:')
    failInitializationMarker(db)

    expect(() => insertRow(db, 'accounts', account('Inserted'))).toThrow(/simulated meta failure/i)

    expect(getRow(db, 'accounts', 'account-atomicity')).toBeUndefined()
    expect(isInitialized(db)).toBe(false)
    expect(db.isTransaction).toBe(false)
    db.close()
  })

  it('rolls back an upsert update when the initialization marker fails', () => {
    const db = openDb(':memory:')
    db.prepare(`
      INSERT INTO accounts (id, name, color, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `).run('account-atomicity', 'Before', '#2d75da', TS, TS)
    failInitializationMarker(db)

    expect(() => upsertRow(db, 'accounts', account('After'))).toThrow(/simulated meta failure/i)

    expect(getRow(db, 'accounts', 'account-atomicity')?.name).toBe('Before')
    expect(isInitialized(db)).toBe(false)
    expect(db.isTransaction).toBe(false)
    db.close()
  })

  it('uses a savepoint so a caught helper failure cannot leak its row into an outer commit', () => {
    const db = openDb(':memory:')
    failInitializationMarker(db)

    tx(db, () => {
      expect(() => insertRow(db, 'accounts', account('Nested'))).toThrow(/simulated meta failure/i)
      // The caller deliberately handles that local failure and commits unrelated work. The nested
      // helper must already have rolled its own row back rather than relying on the outer rollback.
      db.prepare(`INSERT INTO _meta (key, value) VALUES ('outer-work', 'committed')`).run()
    })

    expect(getRow(db, 'accounts', 'account-atomicity')).toBeUndefined()
    expect(db.prepare(`SELECT value FROM _meta WHERE key = 'outer-work'`).get()).toEqual({ value: 'committed' })
    expect(db.isTransaction).toBe(false)
    db.close()
  })
})
