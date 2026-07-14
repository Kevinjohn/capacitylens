import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import {
  ensureControlTables,
  upsertMember,
  getMemberRole,
  listMembershipsForUser,
  listMembersForAccount,
  countOwners,
  removeMember,
  getUsersByIds,
  createInvite,
  getInvite,
  newInviteId,
  listInvitesForAccount,
  revokeInvite,
  pruneInvites,
  markInviteUsed,
  InviteAlreadyUsedError,
  looksLikeEmail,
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

  it('rolls back the entire plaintext-token rebuild when a legacy row cannot migrate', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE invites (
      token TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      role TEXT,
      preauthEmail TEXT,
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      createdAt TEXT NOT NULL
    )`)
    db.prepare(`INSERT INTO invites (token, accountId, role, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?)`)
      .run('still-secret', 'a1', null, '2099-01-01T00:00:00.000Z', TS)

    expect(() => ensureControlTables(db as Db)).toThrow()
    expect((db.prepare(`SELECT token FROM invites`).get() as { token: string }).token).toBe('still-secret')
    expect((db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='invites_new'`).get() as { n: number }).n).toBe(0)
    const columns = db.prepare(`PRAGMA table_info(invites)`).all() as Array<{ name: string }>
    expect(columns.some((column) => column.name === 'id')).toBe(false)
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

// ── P1.11 member-management helpers ────────────────────────────────────────────────────────────

describe('listMembersForAccount', () => {
  it('lists only the requested account\'s members, in a stable createdAt order', () => {
    const db = freshDb()
    upsertMember(db, member({ accountId: 'acc-1', userId: 'u-b', role: 'editor', createdAt: '2026-01-02T00:00:00.000Z' }))
    upsertMember(db, member({ accountId: 'acc-1', userId: 'u-a', role: 'owner', createdAt: '2026-01-01T00:00:00.000Z' }))
    upsertMember(db, member({ accountId: 'acc-2', userId: 'u-c', role: 'admin' }))

    const rows = listMembersForAccount(db, 'acc-1')
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.accountId === 'acc-1')).toBe(true)
    expect(rows.map((r) => r.userId)).toEqual(['u-a', 'u-b']) // ordered by createdAt then userId
  })

  it('returns an empty array for an account with no members', () => {
    const db = freshDb()
    expect(listMembersForAccount(db, 'nobody')).toEqual([])
  })
})

describe('countOwners', () => {
  it('counts ONLY active owners of the account', () => {
    const db = freshDb()
    upsertMember(db, member({ accountId: 'acc-1', userId: 'u-1', role: 'owner' }))
    upsertMember(db, member({ accountId: 'acc-1', userId: 'u-2', role: 'owner' }))
    upsertMember(db, member({ accountId: 'acc-1', userId: 'u-3', role: 'admin' }))
    upsertMember(db, member({ accountId: 'acc-2', userId: 'u-4', role: 'owner' })) // other account
    expect(countOwners(db, 'acc-1')).toBe(2)
    expect(countOwners(db, 'acc-2')).toBe(1)
    expect(countOwners(db, 'empty')).toBe(0)
  })
})

describe('removeMember', () => {
  it('removes the named membership and is idempotent (a missing row is a no-op)', () => {
    const db = freshDb()
    upsertMember(db, member({ accountId: 'acc-1', userId: 'u-1', role: 'editor' }))
    removeMember(db, 'acc-1', 'u-1')
    expect(getMemberRole(db, 'acc-1', 'u-1')).toBeNull()
    expect(() => removeMember(db, 'acc-1', 'u-1')).not.toThrow() // idempotent
  })

  it('only deletes the row of the named account (cross-tenant safe)', () => {
    const db = freshDb()
    upsertMember(db, member({ accountId: 'acc-1', userId: 'u-1', role: 'editor' }))
    upsertMember(db, member({ accountId: 'acc-2', userId: 'u-1', role: 'admin' }))
    removeMember(db, 'acc-1', 'u-1')
    expect(getMemberRole(db, 'acc-1', 'u-1')).toBeNull()
    expect(getMemberRole(db, 'acc-2', 'u-1')).toBe('admin') // the other account's row survives
  })
})

describe('getUsersByIds', () => {
  // The Better Auth `user` table is not part of ensureControlTables (it's created by Better Auth's
  // migrations); create a minimal stand-in so this unit can read it.
  const dbWithUsers = (): Db => {
    const db = freshDb()
    db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT, emailVerified INTEGER)`)
    db.prepare(`INSERT INTO user (id, name, email, emailVerified) VALUES (?, ?, ?, 1)`).run('u-1', 'Alice', 'alice@x.io')
    db.prepare(`INSERT INTO user (id, name, email, emailVerified) VALUES (?, ?, ?, 1)`).run('u-2', null, 'bob@x.io')
    return db
  }

  it('returns an empty map for empty ids (no invalid zero-id IN clause)', () => {
    expect(getUsersByIds(freshDb(), []).size).toBe(0)
  })

  it('resolves name/email for known ids, degrades a null name, omits unknown ids', () => {
    const db = dbWithUsers()
    const map = getUsersByIds(db, ['u-1', 'u-2', 'ghost'])
    expect(map.get('u-1')).toEqual({ name: 'Alice', email: 'alice@x.io' })
    expect(map.get('u-2')).toEqual({ name: null, email: 'bob@x.io' })
    expect(map.has('ghost')).toBe(false) // no row → absent (caller degrades to null)
  })

  it('sanitizes identity names at the member-read boundary', () => {
    const db = dbWithUsers()
    db.prepare(`UPDATE user SET name = ? WHERE id = ?`).run('  Alice 💩   Example  ', 'u-1')
    expect(getUsersByIds(db, ['u-1']).get('u-1')?.name).toBe('Alice Example')
  })
})

const TS_FUTURE = '2999-01-01T00:00:00.000Z'

const invite = (over: Partial<Parameters<typeof createInvite>[1]> = {}) => ({
  token: `tok-${over.id ?? '1'}`,
  id: 'inv-1',
  accountId: 'acc-1',
  role: 'editor' as const,
  preauthEmail: null,
  expiresAt: TS_FUTURE,
  usedAt: null,
  createdAt: TS,
  ...over,
})

describe('createInvite / getInvite — non-secret id (P1.11)', () => {
  it('round-trips the id through getInvite', () => {
    const db = freshDb()
    const id = newInviteId()
    expect(id.length).toBeGreaterThan(0)
    createInvite(db, invite({ token: 'tok-a', id }))
    expect(getInvite(db, 'tok-a')!.id).toBe(id)
  })

  it('newInviteId mints distinct ids', () => {
    expect(newInviteId()).not.toBe(newInviteId())
  })
})

describe('invite validation and single-use consumption', () => {
  it('enforces the shared email-length ceiling', () => {
    expect(looksLikeEmail('person@example.com')).toBe(true)
    expect(looksLikeEmail(`${'a'.repeat(250)}@x.io`)).toBe(false)
  })

  it('throws a typed conflict when the conditional consume loses the race', () => {
    const db = freshDb()
    createInvite(db, invite({ token: 'race-token', id: 'race-invite' }))
    markInviteUsed(db, 'race-token', TS)
    expect(() => markInviteUsed(db, 'race-token', TS)).toThrow(InviteAlreadyUsedError)
  })
})

describe('listInvitesForAccount', () => {
  it('lists an account\'s invites WITHOUT the token, newest first', () => {
    const db = freshDb()
    createInvite(db, invite({ token: 'tok-1', id: 'inv-1', createdAt: '2026-01-01T00:00:00.000Z' }))
    createInvite(db, invite({ token: 'tok-2', id: 'inv-2', createdAt: '2026-01-02T00:00:00.000Z' }))
    createInvite(db, invite({ token: 'tok-3', id: 'inv-3', accountId: 'acc-2' })) // other account

    const list = listInvitesForAccount(db, 'acc-1')
    expect(list.map((i) => i.id)).toEqual(['inv-2', 'inv-1']) // newest first
    // No token field on ANY row (it's a write-once secret — never on a read path).
    expect(list.every((i) => !('token' in i))).toBe(true)
    expect(JSON.stringify(list)).not.toContain('tok-')
  })

  it('returns an empty array for an account with no invites', () => {
    expect(listInvitesForAccount(freshDb(), 'none')).toEqual([])
  })

  it('lists USED invites too — the members UI shows a consumed invite with a "used" badge', () => {
    const db = freshDb()
    createInvite(db, invite({ token: 'tok-used', id: 'inv-used', usedAt: TS }))
    createInvite(db, invite({ token: 'tok-open', id: 'inv-open' })) // still unused
    const list = listInvitesForAccount(db, 'acc-1')
    expect(list.map((i) => i.id).sort()).toEqual(['inv-open', 'inv-used'])
    expect(list.find((i) => i.id === 'inv-used')!.usedAt).toBe(TS)
  })
})

describe('pruneInvites', () => {
  const TS_EXPIRED = '2000-01-01T00:00:00.000Z'

  it('deletes ONLY expired-unused links; keeps used invites and still-live invites', () => {
    const db = freshDb()
    createInvite(db, invite({ token: 'tok-live', id: 'inv-live' })) // unused, future expiry
    createInvite(db, invite({ token: 'tok-used', id: 'inv-used', usedAt: TS, expiresAt: TS_EXPIRED })) // used + expired
    createInvite(db, invite({ token: 'tok-dead', id: 'inv-dead', expiresAt: TS_EXPIRED })) // unused + expired → dead link

    expect(pruneInvites(db)).toBe(1) // only the dead unused link is removed
    expect(getInvite(db, 'tok-dead')).toBeNull()
    // A USED invite survives pruning even when expired — the members list must still show it.
    expect(getInvite(db, 'tok-used')).not.toBeNull()
    expect(getInvite(db, 'tok-live')).not.toBeNull()
  })
})

describe('revokeInvite', () => {
  it('deletes the invite by id (scoped to its account) and is idempotent', () => {
    const db = freshDb()
    createInvite(db, invite({ token: 'tok-1', id: 'inv-1' }))
    revokeInvite(db, 'acc-1', 'inv-1')
    expect(getInvite(db, 'tok-1')).toBeNull()
    expect(() => revokeInvite(db, 'acc-1', 'inv-1')).not.toThrow() // idempotent
  })

  it('cross-tenant revoke is a NO-OP — an admin of one account can\'t revoke another\'s invite', () => {
    const db = freshDb()
    createInvite(db, invite({ token: 'tok-1', id: 'inv-1', accountId: 'acc-1' }))
    revokeInvite(db, 'acc-2', 'inv-1') // wrong account predicate → no row matches
    expect(getInvite(db, 'tok-1')).not.toBeNull() // survives
  })
})
