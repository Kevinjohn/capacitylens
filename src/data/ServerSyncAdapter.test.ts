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

describe('auth-awareness (P3.4)', () => {
  it('sends credentials on every request so a session cookie reaches an auth-enabled server', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).endsWith('/api/state')) return new Response(JSON.stringify(emptyAppData()), { status: 200 })
      return new Response('{}', { status: 200 })
    })
    const adapter = new ServerSyncAdapter('http://api.test', fetchImpl as unknown as typeof fetch)
    await adapter.loadAll()
    await adapter.hasExisting()
    await adapter.saveAll(withData({ clients: [client('c1')] }))
    expect(calls.length).toBeGreaterThanOrEqual(3) // state, meta, batch
    for (const { url, init } of calls) {
      expect(init?.credentials, url).toBe('include')
    }
  })
})

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

  it('orders all upserts before all deletes (so a reparent lands before the old parent is deleted)', () => {
    const prev = withData({ clients: [client('old')] })
    const next = withData({ clients: [client('new')] })
    const ops = diffOps(prev, next)
    expect(ops[0]).toMatchObject({ method: 'PUT', id: 'new' })
    expect(ops[1]).toMatchObject({ method: 'DELETE', id: 'old' })
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

// Helper: pull the parsed ops array out of a recorded /api/batch POST.
const batchOps = (call: unknown[]): Array<{ method: string; table: string; id: string; accountId?: string }> =>
  JSON.parse((call[1] as RequestInit).body as string).ops

describe('ServerSyncAdapter.saveAll', () => {
  it('sends the diffed ops to /api/batch in one ordered request', async () => {
    const fetchImpl = okFetch() as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x/', fetchImpl)
    await a.saveAll(withData({ clients: [client('c1')], projects: [project('p1', 'c1')] }))
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('http://x/api/batch')
    expect((calls[0][1] as RequestInit).method).toBe('POST')
    expect(batchOps(calls[0]).map((o) => `${o.method} ${o.table}/${o.id}`)).toEqual([
      'PUT clients/c1', // upserts parent-first
      'PUT projects/p1',
    ])
  })

  it('does NOT advance the snapshot on a failed batch, so the next save replays the delta', async () => {
    let failNext = false
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/batch') && failNext) return new Response('boom', { status: 500 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    failNext = true
    await expect(a.saveAll(withData({ clients: [client('c1')] }))).rejects.toThrow()

    // Recover: the same state replays as one batch with c1 (not lost).
    failNext = false
    ;(fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear()
    await a.saveAll(withData({ clients: [client('c1')] }))
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(1)
    expect(batchOps(calls[0])).toHaveLength(1)
  })

  it('flushes on unload as ONE keepalive batch request (survives the page teardown, no per-op FK race)', async () => {
    const fetchImpl = okFetch() as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    await a.saveAll(withData({ clients: [client('c1')], projects: [project('p1', 'c1')] }), { unload: true })
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('http://x/api/batch')
    const init = calls[0][1] as RequestInit
    expect(init.keepalive).toBe(true)
    expect(batchOps(calls[0])).toHaveLength(2) // all ops in one ordered request
  })

  it('carries the owning account on a scoped DELETE op; accounts (top-level) carry none', async () => {
    const account = { id: 'a1', name: 'Co', color: '#3b82f6', createdAt: TS1, updatedAt: TS1 }
    const prev = withData({ accounts: [account], clients: [client('c1')] })
    const fetchImpl = okFetch() as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    await a.saveAll(prev) // create a1 + c1; lastSynced = prev
    ;(fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear()
    await a.saveAll(emptyAppData()) // diff prev→empty = deletes

    const ops = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0])
    expect(ops.find((o) => o.table === 'clients')).toMatchObject({ method: 'DELETE', id: 'c1', accountId: 'a1' })
    expect(ops.find((o) => o.table === 'accounts')?.accountId).toBeUndefined()
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
    const batches = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      batchOps(c).map((o) => o.id),
    )
    // first batch: [c1]; coalesced second batch: [c2] only (c1 already synced).
    expect(batches).toEqual([['c1'], ['c2']])
  })
})
