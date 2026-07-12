import { describe, it, expect, vi } from 'vitest'
import { ServerSyncAdapter, BatchConflictError, MAX_OPS_PER_BATCH, diffOps, applyOps } from './ServerSyncAdapter'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import type { AppData, Client, Project } from '@capacitylens/shared/types/entities'

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
  it('GETs /api/state (no-arg whole read, OFF/fallback), migrates, and seeds the snapshot so the next save diffs against it', async () => {
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

  it('loadAll(accountId) GETs /api/state?accountId= and seeds the snapshot to THAT slice (zero ops on an identical save)', async () => {
    // Per-account hydration (P1.13): the picker chose a1, so we load ONLY a1's slice.
    const a1Slice = withData({ clients: [client('c1')] })
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url)
      if (url.includes('/api/state')) return new Response(JSON.stringify(a1Slice), { status: 200 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    const loaded = await a.loadAll('a1')
    expect(loaded.clients).toHaveLength(1)
    expect(urls[0]).toBe('http://x/api/state?accountId=a1') // scoped read, not the whole tree
    // Snapshot == the loaded a1 slice, so re-saving it emits ZERO ops.
    const callsBefore = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    await a.saveAll(a1Slice)
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)
  })

  it('CROSS-ACCOUNT REGRESSION: re-seed to a2 then save a2 emits ONLY a2 ops — never deletes of a1', async () => {
    // The #1 correctness guard (§5): after a switch, lastSynced (the diff snapshot) MUST be the NEW
    // account's slice. If it stayed a1's, the first a2 save would diff a1→a2 and emit DELETEs for a1's
    // rows + PUTs for a2's — catastrophic cross-account data loss. The switch orchestrator (persist.ts)
    // achieves this by calling loadAll(a2), which re-seeds the snapshot to a2's slice.
    const a1c = client('c1') // accountId 'a1'
    const a2c: Client = { id: 'c2', accountId: 'a2', name: 'Beta', color: '#3b82f6', createdAt: TS1, updatedAt: TS1 }
    const a1Slice = withData({ clients: [a1c] })
    const a2Slice = withData({ clients: [a2c] })
    let nextSlice = a1Slice
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/api/state')) return new Response(JSON.stringify(nextSlice), { status: 200 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    await a.loadAll('a1') // snapshot = a1's slice
    nextSlice = a2Slice
    await a.loadAll('a2') // RE-SEED: snapshot is now a2's slice (the orchestrator's atomic re-seed)
    ;(fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear()

    // Saving a2's slice now diffs a2→a2 = ZERO ops. Critically it does NOT emit a DELETE for c1 (a1).
    await a.saveAll(a2Slice)
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(0) // no batch at all — snapshot already equals a2's slice

    // And an EDIT to a2 emits only the a2 op (a PUT c2), never a delete of c1.
    ;(fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear()
    await a.saveAll(withData({ clients: [{ ...a2c, name: 'Beta II', updatedAt: TS2 }] }))
    const ops = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0])
    expect(ops.every((o) => o.id !== 'c1')).toBe(true) // NEVER touches a1's row
    expect(ops).toEqual([expect.objectContaining({ method: 'PUT', table: 'clients', id: 'c2' })])
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

  it('maps a 409 batch response to BatchConflictError carrying body.error (+ current)', async () => {
    // 409 is the server's optimistic-concurrency conflict signal ({ error, current }). It must
    // surface as the TYPED BatchConflictError — persist.ts branches on it to resolve by reloading
    // (server wins) instead of futilely retrying the same stale diff.
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/batch')) {
        return new Response(
          JSON.stringify({ error: 'Someone else saved a newer version of this record.', current: { id: 'c1' } }),
          { status: 409 },
        )
      }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    const err: unknown = await a.saveAll(withData({ clients: [client('c1')] })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BatchConflictError)
    expect((err as BatchConflictError).message).toBe('Someone else saved a newer version of this record.')
    expect((err as BatchConflictError).current).toEqual({ id: 'c1' })
  })

  it('a 409 with an unreadable body still throws BatchConflictError (best-effort parse)', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>proxy error</html>', { status: 409 })) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    const err: unknown = await a.saveAll(withData({ clients: [client('c1')] })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BatchConflictError)
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

describe('batch chunking (large imports vs the server MAX_BATCH_OPS cap)', () => {
  // An in-app import can produce tens of thousands of ops (fresh ids + deletes); the server rejects
  // any single batch over 5000 ops, so the adapter must split the ordered op list into consecutive
  // ≤MAX_OPS_PER_BATCH chunks POSTed sequentially — order preserved, lastSynced advanced only after
  // ALL chunks land.

  const manyClients = (n: number) => Array.from({ length: n }, (_, i) => client(`c${i}`))

  it('splits 4500 ops into 3 SEQUENTIAL /api/batch POSTs of 2000/2000/500, order preserved', async () => {
    const batches: string[][] = []
    let inFlight = 0
    let maxInFlight = 0
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/batch')) {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        batches.push((JSON.parse(init?.body as string) as { ops: Array<{ id: string }> }).ops.map((o) => o.id))
        await new Promise((r) => setTimeout(r, 0)) // hold each request open a tick to expose overlap
        inFlight -= 1
      }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    const clients = manyClients(4500)
    await a.saveAll(withData({ clients }))

    expect(batches.map((b) => b.length)).toEqual([MAX_OPS_PER_BATCH, MAX_OPS_PER_BATCH, 500])
    expect(maxInFlight).toBe(1) // strictly sequential — never overlapping requests
    // The concatenated chunks are EXACTLY the full ordered op list (no reorder across chunks).
    expect(batches.flat()).toEqual(clients.map((c) => c.id))
  })

  it('a mid-sequence chunk failure does NOT advance the snapshot — the retry re-sends the FULL diff', async () => {
    // Chunks are individually transactional, so chunk 1 lands and chunk 2 fails → a partial write.
    // Safe because ops are idempotent upserts/deletes and lastSynced only advances after ALL chunks:
    // the retry replays the whole 4500-op diff (chunk 1 re-applies as no-op upserts).
    let batchCount = 0
    let failSecond = true
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/batch')) {
        batchCount += 1
        if (batchCount === 2 && failSecond) return new Response('boom', { status: 500 })
      }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    const data = withData({ clients: manyClients(4500) })

    await expect(a.saveAll(data)).rejects.toThrow('Batch sync failed (500)')
    expect(batchCount).toBe(2) // chunk 3 never dispatched after chunk 2 failed

    // Retry with the same state: the FULL diff is re-sent as 3 chunks (snapshot did not advance).
    failSecond = false
    batchCount = 0
    ;(fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear()
    await a.saveAll(data)
    const sizes = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => String(c[0]).endsWith('/api/batch'))
      .map((c) => batchOps(c as unknown[]).length)
    expect(sizes).toEqual([MAX_OPS_PER_BATCH, MAX_OPS_PER_BATCH, 500])
  })

  it('the unload path dispatches ALL keepalive chunks up-front (no await between dispatches)', async () => {
    // Page teardown: awaiting between chunks would leave only the first on the wire before the
    // event loop dies. All chunks must be DISPATCHED before any response resolves.
    const resolvers: Array<() => void> = []
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(() => resolve(new Response('{}', { status: 200 })))
        }),
    ) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    const p = a.saveAll(withData({ clients: manyClients(4500) }), { unload: true })
    // All 3 chunk requests are already on the wire — none awaited another's response.
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(3)
    for (const c of calls) {
      expect((c[1] as RequestInit).keepalive).toBe(true)
    }
    resolvers.forEach((r) => r())
    await p
  })
})
