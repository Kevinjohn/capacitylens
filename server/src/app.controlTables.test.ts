import { describe, it, expect } from 'vitest'
import { buildApp } from './app'
import { openDb, loadState } from './db'
import { upsertMember } from './controlTables'

// P1.1 EXCLUSION proof: the `account_members` server-control table must be UNREACHABLE through the
// generic entity machinery and ABSENT from the state read. openDb creates it on every open, so even
// with a row present it must not leak through /api/:entity, GET /api/state (the state read/export
// source; there is no separate /api/state/export route today — loadState IS the export source), or
// loadState itself.

describe('account_members is excluded from the AppData path', () => {
  it('is not a known entity for generic CRUD (GET + POST → 4xx, not 200)', async () => {
    const app = buildApp(openDb(':memory:'))

    // No GET /api/:entity route exists at all → Fastify 404 (never a 200 listing the table).
    const get = await app.inject({ method: 'GET', url: '/api/account_members' })
    expect(get.statusCode).toBe(404)

    // POST /api/:entity gates on isKnownTable → 404 "Unknown entity", the SAME refusal any unknown
    // table gets — never a 200/201 that would persist a row through the entity path.
    const post = await app.inject({
      method: 'POST',
      url: '/api/account_members',
      payload: { accountId: 'a', userId: 'u', role: 'admin', status: 'active', createdAt: 'x' },
    })
    expect(post.statusCode).toBe(404)
  })

  it('never appears in GET /api/state or loadState, even with a member row present', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db)

    // Insert a real membership row directly through the control-table helper (the only path that
    // touches it). It must STILL not surface in the AppData read/export.
    upsertMember(db, {
      accountId: 'acc-1',
      userId: 'user-1',
      role: 'owner',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    // The wire shape: GET /api/state backs the client hydrate and is the export source.
    const res = await app.inject({ method: 'GET', url: '/api/state' })
    expect(res.statusCode).toBe(200)
    const state = res.json() as Record<string, unknown>
    expect(state).not.toHaveProperty('account_members')
    // Belt-and-braces: no value anywhere in the serialised state mentions the table or the row.
    expect(JSON.stringify(state)).not.toContain('account_members')
    expect(JSON.stringify(state)).not.toContain('user-1')

    // And loadState (the function GET /api/state and export both call) has no such key either.
    expect(loadState(db) as unknown as Record<string, unknown>).not.toHaveProperty('account_members')
  })
})
