import { describe, it, expect, vi } from 'vitest'
import { ServerSyncAdapter, diffOps } from './ServerSyncAdapter'
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
