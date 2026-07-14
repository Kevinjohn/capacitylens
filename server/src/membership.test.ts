import { describe, it, expect } from 'vitest'
import { openDb, upsertRow, type Db } from './db'
import { upsertMember } from './controlTables'
import { listAccounts, resolveRole } from './membership'
import type { SessionUser } from './auth'

// Unit tests for the tenancy seam (P1.2): listAccounts + resolveRole over P1.1's control helpers.
// openDb(':memory:') is used (not a bare DatabaseSync) because these functions read the REAL
// `accounts` table — openDb runs SCHEMA_SQL (accounts) AND ensureControlTables (account_members), so
// a single in-memory DB gives both.

const TS = '2026-01-01T00:00:00.000Z'

const freshDb = (): Db => openDb(':memory:')

/** Insert a minimal valid account row (id/name/color/createdAt/updatedAt are the NOT NULL cols). */
const addAccount = (db: Db, id: string, name: string): void =>
  upsertRow(db, 'accounts', { id, name, color: '#111111', createdAt: TS, updatedAt: TS })

const session = (id: string): SessionUser => ({
  id,
  name: `name-${id}`,
  email: `${id}@capacitylens.dev`,
  emailVerified: true,
})

describe('resolveRole', () => {
  it('returns the role for an account the login is an active member of', () => {
    const db = freshDb()
    addAccount(db, 'acc-1', 'Alpha')
    upsertMember(db, { accountId: 'acc-1', userId: 'user-1', role: 'admin', status: 'active', createdAt: TS })
    expect(resolveRole(db, session('user-1'), 'acc-1')).toBe('admin')
  })

  it('returns null for a non-member (account the login has no membership in)', () => {
    const db = freshDb()
    addAccount(db, 'acc-1', 'Alpha')
    addAccount(db, 'acc-2', 'Beta')
    upsertMember(db, { accountId: 'acc-1', userId: 'user-1', role: 'owner', status: 'active', createdAt: TS })
    // Member of acc-1, but not acc-2.
    expect(resolveRole(db, session('user-1'), 'acc-2')).toBeNull()
  })

  it('returns null for a different login (no membership row at all)', () => {
    const db = freshDb()
    addAccount(db, 'acc-1', 'Alpha')
    upsertMember(db, { accountId: 'acc-1', userId: 'user-1', role: 'editor', status: 'active', createdAt: TS })
    expect(resolveRole(db, session('nobody'), 'acc-1')).toBeNull()
  })

  it('enforces cross-account isolation: userA does not inherit userB\'s role', () => {
    const db = freshDb()
    addAccount(db, 'acc-1', 'Alpha')
    addAccount(db, 'acc-2', 'Beta')
    upsertMember(db, { accountId: 'acc-1', userId: 'userA', role: 'editor', status: 'active', createdAt: TS })
    upsertMember(db, { accountId: 'acc-2', userId: 'userB', role: 'owner', status: 'active', createdAt: TS })
    // userA is NOT given userB's acc-2/owner role; userB is NOT given userA's acc-1/editor role.
    expect(resolveRole(db, session('userA'), 'acc-2')).toBeNull()
    expect(resolveRole(db, session('userB'), 'acc-1')).toBeNull()
    // Each keeps exactly their own.
    expect(resolveRole(db, session('userA'), 'acc-1')).toBe('editor')
    expect(resolveRole(db, session('userB'), 'acc-2')).toBe('owner')
  })
})

describe('listAccounts', () => {
  it('returns exactly the caller\'s active-membership account summaries, ordered by name then id', () => {
    const db = freshDb()
    addAccount(db, 'acc-z', 'Zulu')
    addAccount(db, 'acc-a', 'Alpha')
    addAccount(db, 'acc-other', 'Other')
    upsertMember(db, { accountId: 'acc-z', userId: 'user-1', role: 'viewer', status: 'active', createdAt: TS })
    upsertMember(db, { accountId: 'acc-a', userId: 'user-1', role: 'owner', status: 'active', createdAt: TS })
    // acc-other belongs to someone else — must NOT appear for user-1.
    upsertMember(db, { accountId: 'acc-other', userId: 'user-2', role: 'admin', status: 'active', createdAt: TS })

    const out = listAccounts(db, session('user-1'))
    // Exactly the two the login is a member of, sorted by name (Alpha before Zulu); id+name+role
    // correct — the caller's per-account role (owner of acc-a, viewer of acc-z) rides on each summary.
    expect(out).toEqual([
      { id: 'acc-a', name: 'Alpha', role: 'owner' },
      { id: 'acc-z', name: 'Zulu', role: 'viewer' },
    ])
  })

  it('returns an empty array for a login with no memberships', () => {
    const db = freshDb()
    addAccount(db, 'acc-1', 'Alpha')
    expect(listAccounts(db, session('ghost'))).toEqual([])
  })

  it('excludes a NON-active membership (status filter) — and resolveRole returns null for it', () => {
    const db = freshDb()
    addAccount(db, 'acc-active', 'Active Co')
    addAccount(db, 'acc-invited', 'Invited Co')
    upsertMember(db, { accountId: 'acc-active', userId: 'user-1', role: 'editor', status: 'active', createdAt: TS })
    // Insert a NON-active row directly: MembershipStatus only types 'active', so go past it via raw
    // SQL to model a future 'invited' lifecycle state and prove the active-only filter.
    db.prepare(
      `INSERT INTO account_members (accountId, userId, role, status, createdAt) VALUES (?, ?, ?, ?, ?)`,
    ).run('acc-invited', 'user-1', 'editor', 'invited', TS)

    // listAccounts lists ONLY the active one — the invited account is filtered out.
    expect(listAccounts(db, session('user-1'))).toEqual([{ id: 'acc-active', name: 'Active Co', role: 'editor' }])
    // resolveRole grants the active membership but NOT the non-active one.
    expect(resolveRole(db, session('user-1'), 'acc-active')).toBe('editor')
    expect(resolveRole(db, session('user-1'), 'acc-invited')).toBeNull()
  })

  it('skips a dangling membership (account row missing) without throwing', () => {
    const db = freshDb()
    addAccount(db, 'acc-real', 'Real Co')
    upsertMember(db, { accountId: 'acc-real', userId: 'user-1', role: 'admin', status: 'active', createdAt: TS })
    // A membership whose account row does not exist — getRow returns undefined; must be skipped.
    upsertMember(db, { accountId: 'acc-gone', userId: 'user-1', role: 'owner', status: 'active', createdAt: TS })

    expect(() => listAccounts(db, session('user-1'))).not.toThrow()
    expect(listAccounts(db, session('user-1'))).toEqual([{ id: 'acc-real', name: 'Real Co', role: 'admin' }])
  })
})
