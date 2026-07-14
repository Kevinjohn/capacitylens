import { describe, it, expect } from 'vitest'
import { migrate } from './migrate'
import { seed } from './seed'
import { serializeData, parseData } from './transfer'
import { ensureInternalClients, internalClientFor, buildInternalClient, wouldAddSecondBuiltin, INTERNAL_CLIENT_NAME } from './internalClient'
import { emptyAppData } from '../types/entities'
import type { Client } from '../types/entities'

const TS = '2026-01-01T00:00:00.000Z'

describe('built-in Internal client', () => {
  it('seed gives every account exactly one builtin Internal client', () => {
    const data = seed()
    for (const account of data.accounts) {
      const internal = data.clients.filter((c) => c.builtin === true && c.accountId === account.id)
      expect(internal).toHaveLength(1)
      expect(internal[0].name).toBe(INTERNAL_CLIENT_NAME)
    }
  })

  it('ensureInternalClients adds one Internal per account that lacks one, and is idempotent', () => {
    const base = {
      ...emptyAppData(),
      accounts: [
        { id: 'a1', createdAt: TS, updatedAt: TS, name: 'A1', color: '#111111' },
        { id: 'a2', createdAt: TS, updatedAt: TS, name: 'A2', color: '#222222' },
      ],
    }
    const once = ensureInternalClients(base, TS)
    expect(once.clients.filter((c) => c.builtin)).toHaveLength(2)
    expect(internalClientFor(once.clients, 'a1')).toBeDefined()
    expect(internalClientFor(once.clients, 'a2')).toBeDefined()
    // Run again — no duplicate, and (no change) returns the SAME reference.
    const twice = ensureInternalClients(once, TS)
    expect(twice).toBe(once)
    expect(twice.clients.filter((c) => c.builtin)).toHaveLength(2)
  })

  it('migrate (v5→v6) backfills one Internal per account, idempotently and without duplicating a pre-existing one', () => {
    const blob = {
      schemaVersion: 5,
      data: {
        accounts: [
          { id: 'a1', createdAt: TS, updatedAt: TS, name: 'A1', color: '#111111' },
          { id: 'a2', createdAt: TS, updatedAt: TS, name: 'A2', color: '#222222' },
        ],
        // a1 already has a builtin Internal (must NOT be duplicated); a2 has none.
        clients: [
          { id: 'pre-internal', accountId: 'a1', createdAt: TS, updatedAt: TS, name: 'Internal', color: '#9c3ace', builtin: true },
          { id: 'acme', accountId: 'a1', createdAt: TS, updatedAt: TS, name: 'Acme', color: '#ef4444' },
        ],
      },
    }
    const out = migrate(blob)
    // a1 keeps its single pre-existing Internal (id unchanged); a2 gets a fresh one.
    expect(out.clients.filter((c) => c.builtin && c.accountId === 'a1')).toHaveLength(1)
    expect(internalClientFor(out.clients, 'a1')?.id).toBe('pre-internal')
    expect(out.clients.filter((c) => c.builtin && c.accountId === 'a2')).toHaveLength(1)
    // Re-running migrate over an already-v6 blob never adds another.
    const again = migrate({ schemaVersion: 6, data: out })
    expect(again.clients.filter((c) => c.builtin)).toHaveLength(2)
  })

  it('migrate does NOT add Internal clients to an account-less import slice', () => {
    const out = migrate({ schemaVersion: 5, data: { accounts: [], clients: [{ id: 'c1', accountId: 'a1', createdAt: TS, updatedAt: TS, name: 'A', color: '#1' }] } })
    expect(out.clients.filter((c) => c.builtin)).toHaveLength(0)
  })

  it('seed round-trips deep-equal through serialize → parse (migrate stays idempotent at the current version)', () => {
    const data = seed()
    expect(parseData(serializeData(data))).toEqual(data)
  })

  it('buildInternalClient mints a fresh id and the reserved name/colour with builtin:true', () => {
    const c = buildInternalClient('a9', TS)
    expect(c).toMatchObject({ accountId: 'a9', name: INTERNAL_CLIENT_NAME, builtin: true })
    expect(c.id).toBeTruthy()
  })

  // wouldAddSecondBuiltin is the server-reject predicate (validate.ts). These cases pin it to the
  // exact inline check it replaced: `internalClientFor(...) && existing.id !== id` — including the
  // account-scoping that lets each account keep its own builtin.
  it('wouldAddSecondBuiltin: reproduces the server reject check byte-for-byte', () => {
    const existing: Client = { id: 'c-int', accountId: 'a1', createdAt: TS, updatedAt: TS, name: 'Internal', color: '#9c3ace', builtin: true }
    const clients = [existing]
    // No builtin yet for this account → first builtin is allowed.
    expect(wouldAddSecondBuiltin([], 'a1', 'c-int')).toBe(false)
    // A DIFFERENT id against an account that already has one → would be a second → reject.
    expect(wouldAddSecondBuiltin(clients, 'a1', 'c-int2')).toBe(true)
    // The SAME id (updating the existing builtin) → not a second → allowed.
    expect(wouldAddSecondBuiltin(clients, 'a1', 'c-int')).toBe(false)
    // A different ACCOUNT that has no builtin → allowed (per-account scoping).
    expect(wouldAddSecondBuiltin(clients, 'a2', 'c-int-2')).toBe(false)
  })
})
