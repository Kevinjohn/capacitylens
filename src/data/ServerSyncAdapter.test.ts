import { describe, it, expect, vi } from 'vitest'
import { ServerSyncAdapter, diffOps, applyOps } from './ServerSyncAdapter'
import { emptyAppData } from '@floaty/shared/types/entities'
import type { AppData, Client, Project } from '@floaty/shared/types/entities'

// Unit tests for the diff engine and the sync flush, with a fake fetch. Proves:
// the diff classifies create/update/delete correctly, orders parent-before-child for
// upserts and child-before-parent for deletes, advances the snapshot only on full
// success (so a failure replays), and coalesces overlapping saves.

const TS1 = '2026-01-01T00:00:00.000Z'
const TS2 = '2026-01-02T00:00:00.000Z'
const client = (id: string, updatedAt = TS1): Client => ({ id, accountId: 'a1', name: 'Acme', color: '#3b82f6', createdAt: TS1, updatedAt })
const project = (id: string, clientId: string, updatedAt = TS1): Project => ({ id, accountId: 'a1', name: 'Web', clientId, color: '#3b82f6', createdAt: TS1, updatedAt })

const withData = (over: Partial<AppData>): AppData => ({ ...emptyAppData(), ...over })

describe('diffOps', () => {
  it('emits PUT for new rows, parent-before-child', () => {
    const next = withData({ clients: [client('c1')], projects: [project('p1', 'c1')] })
    const ops = diffOps(emptyAppData(), next)
    expect(ops.map((o) => `${o.method} ${o.table}/${o.id}`)).toEqual([
      'PUT clients/c1',
      'PUT projects/p1',
    ])
  })

  it('emits PUT only for rows whose updatedAt changed', () => {
    const prev = withData({ clients: [client('c1', TS1)] })
    const next = withData({ clients: [client('c1', TS2)] }) // edited
    expect(diffOps(prev, next)).toHaveLength(1)
    // unchanged row → no op
    expect(diffOps(prev, prev)).toHaveLength(0)
  })

  it('emits DELETE for removed rows, child-before-parent', () => {
    const prev = withData({ clients: [client('c1')], projects: [project('p1', 'c1')] })
    const next = emptyAppData() // both gone (e.g. cascade delete of the client)
    const ops = diffOps(prev, next)
    expect(ops.map((o) => `${o.method} ${o.table}/${o.id}`)).toEqual([
      'DELETE projects/p1', // child first
      'DELETE clients/c1',
    ])
  })

  it('orders all deletes before all upserts', () => {
    const prev = withData({ clients: [client('old')] })
    const next = withData({ clients: [client('new')] })
    const ops = diffOps(prev, next)
    expect(ops[0]).toMatchObject({ method: 'DELETE', id: 'old' })
    expect(ops[1]).toMatchObject({ method: 'PUT', id: 'new' })
  })

  it('tags a scoped-entity DELETE with its owning account; accounts (top-level) carry none', () => {
    const account = { id: 'a1', name: 'Co', color: '#3b82f6', createdAt: TS1, updatedAt: TS1 }
    const ops = diffOps(withData({ accounts: [account], clients: [client('c1')] }), emptyAppData())
    expect(ops.find((o) => o.table === 'clients')).toMatchObject({ method: 'DELETE', id: 'c1', accountId: 'a1' })
    expect(ops.find((o) => o.table === 'accounts')?.accountId).toBeUndefined()
  })
})

describe('applyOps', () => {
  it('advances a snapshot by the given upserts and deletes', () => {
    const base = withData({ clients: [client('c1'), client('c2')] })
    const next = applyOps(base, [
      { method: 'PUT', table: 'clients', id: 'c3', row: client('c3') },
      { method: 'DELETE', table: 'clients', id: 'c1' },
    ])
    expect(next.clients.map((c) => c.id).sort()).toEqual(['c2', 'c3']) // c1 removed, c3 added
    expect(base.clients.map((c) => c.id).sort()).toEqual(['c1', 'c2']) // base not mutated
  })
})

function okFetch() {
  return vi.fn(async () => new Response('{}', { status: 200 }))
}

describe('ServerSyncAdapter.loadAll', () => {
  it('GETs /api/state, migrates, and seeds the snapshot so the next save diffs against it', async () => {
    const state = withData({ clients: [client('c1')] })
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/state')) return new Response(JSON.stringify(state), { status: 200 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    const loaded = await a.loadAll()
    expect(loaded.clients).toHaveLength(1)
    // Saving the identical state must emit zero writes (snapshot == loaded).
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    await a.saveAll(state)
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls)
  })
})

describe('ServerSyncAdapter.saveAll', () => {
  it('issues the diffed PUT/DELETE requests in order', async () => {
    const fetchImpl = okFetch() as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x/', fetchImpl)
    await a.saveAll(withData({ clients: [client('c1')], projects: [project('p1', 'c1')] }))
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.map((c) => `${(c[1] as RequestInit).method} ${c[0]}`)).toEqual([
      'PUT http://x/api/clients/c1',
      'PUT http://x/api/projects/p1',
    ])
  })

  it('does NOT advance the snapshot on failure, so the next save replays the delta', async () => {
    let failNext = false
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const isWrite = init?.method === 'PUT' || init?.method === 'DELETE'
      if (isWrite && failNext && url.includes('/api/')) return new Response('boom', { status: 500 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    failNext = true
    await expect(a.saveAll(withData({ clients: [client('c1')] }))).rejects.toThrow()

    // Recover: same state should be retried (still one PUT for c1).
    failNext = false
    const before = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    await a.saveAll(withData({ clients: [client('c1')] }))
    const after = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
      .slice(before)
      .filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
    expect(after).toHaveLength(1) // replayed, not lost
  })

  it('issues writes with keepalive so a pagehide flush is not cancelled by the unload', async () => {
    const fetchImpl = okFetch() as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    await a.saveAll(withData({ clients: [client('c1')] }))
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect(init.keepalive).toBe(true)
  })

  it('on an UNLOAD flush dispatches EVERY op up-front (not awaiting each), so a pagehide sends them all', async () => {
    const dispatched: string[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    // Responses never resolve until released — simulates the page tearing down before any
    // response lands. A sequential await-loop would only get the FIRST request out; the
    // unload path must fire all three synchronously.
    const fetchImpl = vi.fn((url: string) => {
      dispatched.push(url)
      return gate.then(() => new Response('{}', { status: 200 }))
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    const p = a.saveAll(withData({ clients: [client('c1'), client('c2'), client('c3')] }), { unload: true })
    await Promise.resolve() // let the synchronous dispatch settle past any microtask boundary
    expect(dispatched).toEqual([
      'http://x/api/clients/c1',
      'http://x/api/clients/c2',
      'http://x/api/clients/c3',
    ])
    release()
    await p
  })

  it('puts the owning account on a scoped DELETE URL (so the server can refuse cross-account)', async () => {
    const account = { id: 'a1', name: 'Co', color: '#3b82f6', createdAt: TS1, updatedAt: TS1 }
    const prev = withData({ accounts: [account], clients: [client('c1')] })
    const fetchImpl = okFetch() as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    await a.saveAll(prev) // create a1 + c1; lastSynced = prev
    ;(fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear()
    await a.saveAll(emptyAppData()) // diff prev→empty = deletes

    const deleteUrls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE')
      .map((c) => c[0] as string)
    expect(deleteUrls).toContain('http://x/api/clients/c1?accountId=a1') // scoped
    expect(deleteUrls).toContain('http://x/api/accounts/a1') // top-level: no query param
  })

  it('attempts EVERY op even when one fails, so a poison row does not block the others', async () => {
    const attempted: string[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT' || init?.method === 'DELETE') attempted.push(url)
      if (url.endsWith('/api/clients/c1')) return new Response('boom', { status: 400 }) // poison row
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    await expect(a.saveAll(withData({ clients: [client('c1'), client('c2')] }))).rejects.toThrow()
    // c2 is still attempted despite c1 failing first (was: stop at first failure → only c1).
    expect(attempted).toEqual(['http://x/api/clients/c1', 'http://x/api/clients/c2'])
  })

  it('advances past the ops that LANDED, so only the failed row retries (poison isolated)', async () => {
    let failC1 = true
    const attempted: string[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT' || init?.method === 'DELETE') attempted.push(url)
      if (url.endsWith('/api/clients/c1') && failC1) return new Response('boom', { status: 400 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    // First flush: c1 rejected, c2 lands — both attempted.
    await expect(a.saveAll(withData({ clients: [client('c1'), client('c2')] }))).rejects.toThrow()
    expect(attempted).toEqual(['http://x/api/clients/c1', 'http://x/api/clients/c2'])

    // Retry the SAME state: c2 is already synced (snapshot advanced), so ONLY the
    // previously-failed c1 is re-sent — not a full delta replay.
    failC1 = false
    attempted.length = 0
    await a.saveAll(withData({ clients: [client('c1'), client('c2')] }))
    expect(attempted).toEqual(['http://x/api/clients/c1'])
  })

  it('coalesces overlapping saves to the latest state', async () => {
    let resolveFirst: (() => void) | null = null
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          // Hold the very first request open so a second saveAll lands mid-flush.
          if (!resolveFirst) resolveFirst = () => resolve(new Response('{}', { status: 200 }))
          else resolve(new Response('{}', { status: 200 }))
        }),
    ) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    const p1 = a.saveAll(withData({ clients: [client('c1')] }))
    const p2 = a.saveAll(withData({ clients: [client('c1'), client('c2')] }))
    resolveFirst!()
    await Promise.all([p1, p2])
    const puts = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
    )
    // c1 (first flush) then c2 (coalesced second flush) — c1 not re-sent.
    expect(puts.map((c) => c[0])).toEqual(['http://x/api/clients/c1', 'http://x/api/clients/c2'])
  })
})
