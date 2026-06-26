import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import {
  ensureControlTables,
  upsertMember,
  getMemberRole,
  listMembershipsForUser,
  type AccountMember,
} from './controlTables'
import type { Db } from './db'

// Unit tests for the membership server-CONTROL table (P1.1). A bare in-memory DB + ensureControlTables
// is enough — this table is intentionally decoupled from AppData/openDb, so it needs no schema setup
// beyond its own DDL. (openDb wiring + the AppData-exclusion guarantees are covered in
// app.controlTables.test.ts.)

const TS = '2026-01-01T00:00:00.000Z'

const freshDb = (): Db => {
  const db = new DatabaseSync(':memory:')
  ensureControlTables(db)
  return db
}

const member = (over: Partial<AccountMember> = {}): AccountMember => ({
  accountId: 'acc-1',
  userId: 'user-1',
  role: 'editor',
  status: 'active',
  createdAt: TS,
  ...over,
})

describe('ensureControlTables', () => {
  it('is idempotent — running twice does not throw', () => {
    const db = new DatabaseSync(':memory:')
    ensureControlTables(db)
    expect(() => ensureControlTables(db)).not.toThrow()
  })
})

describe('upsertMember + getMemberRole', () => {
  it('inserts a membership and reads its role back', () => {
    const db = freshDb()
    upsertMember(db, member({ role: 'admin' }))
    expect(getMemberRole(db, 'acc-1', 'user-1')).toBe('admin')
  })

  it('returns null for a non-member (no row)', () => {
    const db = freshDb()
    expect(getMemberRole(db, 'acc-1', 'nobody')).toBeNull()
  })

  it('updates the role of an existing (accountId, userId) instead of duplicating', () => {
    const db = freshDb()
    upsertMember(db, member({ role: 'viewer' }))
    upsertMember(db, member({ role: 'owner' }))
    expect(getMemberRole(db, 'acc-1', 'user-1')).toBe('owner')
    // The PK keeps it to a single row — the upsert mutated in place, it did not insert a second.
    expect(listMembershipsForUser(db, 'user-1')).toHaveLength(1)
  })

  it('rejects a bad role value (fail loud, do not coerce)', () => {
    const db = freshDb()
    // Force an invalid role past the type system, as a crafted/buggy caller could.
    const bad = { ...member(), role: 'superuser' } as unknown as AccountMember
    expect(() => upsertMember(db, bad)).toThrow(/unknown role/i)
  })
})

describe('listMembershipsForUser', () => {
  it('returns only the requested user\'s rows', () => {
    const db = freshDb()
    upsertMember(db, member({ accountId: 'acc-1', userId: 'user-1', role: 'owner' }))
    upsertMember(db, member({ accountId: 'acc-2', userId: 'user-1', role: 'viewer' }))
    upsertMember(db, member({ accountId: 'acc-1', userId: 'user-2', role: 'editor' }))

    const rows = listMembershipsForUser(db, 'user-1')
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.userId === 'user-1')).toBe(true)
    expect(new Set(rows.map((r) => r.accountId))).toEqual(new Set(['acc-1', 'acc-2']))
  })

  it('returns an empty array for a user with no memberships', () => {
    const db = freshDb()
    expect(listMembershipsForUser(db, 'ghost')).toEqual([])
  })
})
