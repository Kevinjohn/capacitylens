import { describe, it, expect, vi } from 'vitest'
import {
  ServerSyncAdapter,
  BatchConflictError,
  KeepaliveNotDispatchedError,
  MAX_OPS_PER_BATCH,
  diffOps,
  applyOps,
} from './ServerSyncAdapter'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import type { Account, AppData, Client, Discipline, Project, TimeOff } from '@capacitylens/shared/types/entities'

// Unit tests for the diff engine and the sync flush, with a fake fetch. Proves:
// the diff classifies create/update/delete correctly, orders parent-before-child for
// upserts and child-before-parent for deletes, advances the snapshot only on full
// success (so a failure replays), and coalesces overlapping saves.

const TS1 = '2026-01-01T00:00:00.000Z'
const TS2 = '2026-01-02T00:00:00.000Z'
const client = (id: string, updatedAt = TS1): Client => ({ id, accountId: 'a1', name: 'Acme', color: '#3b82f6', createdAt: TS1, updatedAt })
const project = (id: string, clientId: string, updatedAt = TS1): Project => ({ id, accountId: 'a1', name: 'Web', clientId, color: '#3b82f6', createdAt: TS1, updatedAt })

const withData = (over: Partial<AppData>): AppData => ({ ...emptyAppData(), ...over })
const account = (id: string): Account => ({ id, name: `Account ${id}`, color: '#5c34d4', createdAt: TS1, updatedAt: TS1 })
const scopedData = (accountId: string, over: Partial<AppData>): AppData =>
  withData({
    ...over,
    accounts: [account(accountId)],
    clients: [
      ...(over.clients ?? []),
      { id: `internal:${accountId}`, accountId, name: 'Internal', color: '#9c3ace', builtin: true, createdAt: TS1, updatedAt: TS1 },
    ],
  })

// Drop known table keys from a slice to simulate an OLDER server omitting them (rolling-deploy skew).
const omitKeys = (data: AppData, ...keys: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)))

const commitReceipt = (init?: RequestInit): Response => {
  let applied = 0
  if (typeof init?.body === 'string') {
    try {
      applied = (JSON.parse(init.body) as { ops?: unknown[] }).ops?.length ?? 0
    } catch {
      // Tests that exercise malformed bodies do not use this helper.
    }
  }
  return new Response(JSON.stringify({ ok: true, applied }), { status: 200 })
}

describe('auth-awareness (P3.4)', () => {
  it('sends credentials on every request so a session cookie reaches an auth-enabled server', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).endsWith('/api/state')) return new Response(JSON.stringify(emptyAppData()), { status: 200 })
      if (String(url).endsWith('/api/meta')) return new Response(JSON.stringify({ hasData: false }), { status: 200 })
      return commitReceipt(init)
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
    const row = { id: 'a1', name: 'Co', color: '#5c34d4', createdAt: TS1, updatedAt: TS1 }
    const ops = diffOps(withData({ accounts: [row], clients: [client('c1')] }), emptyAppData())
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
  return vi.fn(async (_url: string, init?: RequestInit) => commitReceipt(init))
}

describe('ServerSyncAdapter.loadAll', () => {
  it('GETs /api/state (no-arg whole read, OFF/fallback), migrates, and seeds the snapshot so the next save diffs against it', async () => {
    const state = withData({ clients: [client('c1')] })
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/state')) return new Response(JSON.stringify(state), { status: 200 })
      return commitReceipt(init)
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    const loaded = await a.loadAll()
    expect(loaded.clients.some((row) => row.id === 'c1')).toBe(true)
    // Saving the identical state must emit zero writes (snapshot == loaded).
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    await a.saveAll(state)
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls)
  })

  it('tolerates a MISSING table key (rolling deploy: new client, older server) but rejects a PRESENT non-array table', async () => {
    // DEPLOYMENT CONTRACT: a version-skewed OLDER server may OMIT a table this newer client already
    // knows about; that MISSING key hydrates as empty via migrate()/normalize rather than failing the
    // WHOLE load (which would be a total outage on every rolling deploy). But a key that is PRESENT
    // and NOT an array is a corrupt/incomplete payload masquerading as empty data — a HARD failure.
    const missing = new ServerSyncAdapter(
      'http://x',
      vi.fn(async () => new Response(JSON.stringify({ accounts: [] }), { status: 200 })) as unknown as typeof fetch,
    )
    const loaded = await missing.loadAll()
    expect(loaded.clients).toEqual([]) // a missing table hydrated empty — no throw
    expect(loaded.resources).toEqual([])

    const wrongType = new ServerSyncAdapter(
      'http://x',
      vi.fn(async () =>
        new Response(JSON.stringify({ ...emptyAppData(), resources: { bad: true } }), { status: 200 }),
      ) as unknown as typeof fetch,
    )
    await expect(wrongType.loadAll()).rejects.toThrow('invalid state payload')
  })

  it('loadAll(accountId) GETs /api/state?accountId= and seeds the snapshot to THAT slice (zero ops on an identical save)', async () => {
    // Per-account hydration (P1.13): the picker chose a1, so we load ONLY a1's slice.
    const a1Slice = scopedData('a1', { clients: [client('c1')] })
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url)
      if (url.includes('/api/state')) return new Response(JSON.stringify(a1Slice), { status: 200 })
      return commitReceipt(init)
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    const loaded = await a.loadAll('a1')
    expect(loaded.clients.map((row) => row.id).sort()).toEqual(['c1', 'internal:a1'])
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
    const a1Slice = scopedData('a1', { clients: [a1c] })
    const a2Slice = scopedData('a2', { clients: [a2c] })
    let nextSlice = a1Slice
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/state')) return new Response(JSON.stringify(nextSlice), { status: 200 })
      return commitReceipt(init)
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
    await a.saveAll(scopedData('a2', { clients: [{ ...a2c, name: 'Beta II', updatedAt: TS2 }] }))
    const ops = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0])
    expect(ops.every((o) => o.id !== 'c1')).toBe(true) // NEVER touches a1's row
    expect(ops).toEqual([expect.objectContaining({ method: 'PUT', table: 'clients', id: 'c2' })])
  })

  it('scoped loadAll TOLERATES a MISSING known table (rolling deploy) and hydrates it empty', async () => {
    // FIX 1: an older server may OMIT a table this newer client already knows. The scoped path must
    // NOT throw "incomplete state payload" during the skew window — it hydrates the missing table
    // empty, exactly like the unscoped migrate() path, while keeping cross-tenant strictness.
    const slice = omitKeys(scopedData('a1', { clients: [client('c1')] }), 'disciplines') // older server omits disciplines
    const a = new ServerSyncAdapter(
      'http://x',
      vi.fn(async () => new Response(JSON.stringify(slice), { status: 200 })) as unknown as typeof fetch,
    )
    const loaded = await a.loadAll('a1')
    expect(loaded.disciplines).toEqual([]) // missing table hydrated empty — no throw
    expect(loaded.clients.map((r) => r.id).sort()).toEqual(['c1', 'internal:a1']) // present rows intact
  })

  it('scoped loadAll STILL rejects a PRESENT non-array known table', async () => {
    // FIX 1's missing-vs-wrong-type split: a table that is PRESENT and not an array is structural
    // damage and stays a HARD failure on the scoped path too (never coerced to []).
    const slice = { ...scopedData('a1', { clients: [client('c1')] }), resources: { bad: true } }
    const a = new ServerSyncAdapter(
      'http://x',
      vi.fn(async () => new Response(JSON.stringify(slice), { status: 200 })) as unknown as typeof fetch,
    )
    await expect(a.loadAll('a1')).rejects.toThrow('invalid state payload')
  })

  it('scoped loadAll rejects a CROSS-TENANT slice unchanged (missing-key tolerance does not weaken it)', async () => {
    // FIX 1 must NOT relax cross-tenant strictness: a slice whose account belongs to a2 while we asked
    // for a1 is still rejected as a cross-tenant/incomplete payload.
    const wrongTenant = scopedData('a2', { clients: [client('c1')] }) // asked for a1, got a2's slice
    const a = new ServerSyncAdapter(
      'http://x',
      vi.fn(async () => new Response(JSON.stringify(wrongTenant), { status: 200 })) as unknown as typeof fetch,
    )
    await expect(a.loadAll('a1')).rejects.toThrow('cross-tenant or incomplete state payload')
  })

  it('warns ONCE naming the missing table(s) when hydrating them empty (FIX 3)', async () => {
    // FIX 3: a hydrated-empty missing key is DIAGNOSABLE — one console.warn per load listing every
    // omitted table, so a same-version proxy/server bug that drops a table is visible, not silent.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const state = omitKeys(withData({ clients: [client('c1')] }), 'disciplines', 'resources')
      const a = new ServerSyncAdapter(
        'http://x',
        vi.fn(async () => new Response(JSON.stringify(state), { status: 200 })) as unknown as typeof fetch,
      )
      await a.loadAll()
      const warned = warn.mock.calls.filter((c) => String(c[0]).includes('omitted known table'))
      expect(warned).toHaveLength(1) // ONE warn per load, not one per missing key
      expect(String(warned[0][0])).toContain('disciplines')
      expect(String(warned[0][0])).toContain('resources')
    } finally {
      warn.mockRestore()
    }
  })

  it('does NOT warn when every known table is present', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const a = new ServerSyncAdapter(
        'http://x',
        vi.fn(async () => new Response(JSON.stringify(withData({ clients: [client('c1')] })), { status: 200 })) as unknown as typeof fetch,
      )
      await a.loadAll()
      expect(warn.mock.calls.some((c) => String(c[0]).includes('omitted known table'))).toBe(false)
    } finally {
      warn.mockRestore()
    }
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
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/batch') && failNext) return new Response('boom', { status: 500 })
      return commitReceipt(init)
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

  it('dispatches the latest snapshot with keepalive when an ordinary batch is still in flight', async () => {
    let releaseFirst: (() => void) | undefined
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      if (!releaseFirst) {
        return new Promise<Response>((resolve) => {
          releaseFirst = () => resolve(commitReceipt(init))
        })
      }
      return Promise.resolve(commitReceipt(init))
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    const ordinary = a.saveAll(withData({ clients: [client('c1')] }))
    expect(releaseFirst).toBeTypeOf('function')
    const teardown = a.saveAll(withData({ clients: [client('c1'), client('c2')] }), { unload: true })

    // The pagehide call must put the latest state on the wire immediately; it cannot wait for the
    // ordinary response because the document may be terminated first.
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)
    expect((calls[1][1] as RequestInit).keepalive).toBe(true)
    expect(batchOps(calls[1]).map((op) => op.id)).toEqual(['c1', 'c2'])

    releaseFirst!()
    await Promise.all([ordinary, teardown])
    expect(fetchImpl).toHaveBeenCalledTimes(2) // no later non-keepalive drain of the parked state
  })

  it('carries the owning account on a scoped (non-lifecycle) DELETE op; accounts (top-level) carry none', async () => {
    // Uses a scoped NON-lifecycle row (timeOff): lifecycle-entity deletes (clients/projects/resources)
    // are routed OUT of the batch to the dedicated archive/delete endpoints (see the lifecycle-delete
    // suite below), so the "scoped DELETE carries accountId on the wire" contract is asserted here on a
    // table that still rides the batch.
    const account = { id: 'a1', name: 'Co', color: '#3b82f6', createdAt: TS1, updatedAt: TS1 }
    const off: TimeOff = { id: 't1', accountId: 'a1', resourceId: 'r1', startDate: '2026-01-01', endDate: '2026-01-02', type: 'holiday', createdAt: TS1, updatedAt: TS1 }
    const prev = withData({ accounts: [account], timeOff: [off] })
    const fetchImpl = okFetch() as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    await a.saveAll(prev) // create a1 + t1; lastSynced = prev
    ;(fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear()
    await a.saveAll(emptyAppData()) // diff prev→empty = deletes

    const ops = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0])
    expect(ops.find((o) => o.table === 'timeOff')).toMatchObject({ method: 'DELETE', id: 't1', accountId: 'a1' })
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

  it('rejects an HTTP 2xx that does not prove the complete batch committed', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, applied: 0 }), { status: 200 })) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    await expect(a.saveAll(withData({ clients: [client('c1')] }))).rejects.toThrow(
      'Batch sync returned an invalid commit receipt.',
    )
  })

  it('coalesces overlapping saves to the latest state', async () => {
    let resolveFirst: (() => void) | null = null
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          // Hold the very first request open so a second saveAll lands mid-flush.
          if (!resolveFirst) resolveFirst = () => resolve(commitReceipt(init))
          else resolve(commitReceipt(init))
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

  it('rebases a queued edit onto the server revision returned by the in-flight batch', async () => {
    let resolveFirst: ((response: Response) => void) | null = null
    let batchNumber = 0
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      batchNumber += 1
      const current = batchNumber
      const ops = JSON.parse(init?.body as string).ops as Array<{ table: 'clients'; id: string; row: Client }>
      const response = () => new Response(JSON.stringify({
        ok: true,
        applied: ops.length,
        revisions: ops.map((op) => ({
          table: op.table,
          id: op.id,
          createdAt: '2030-01-01T00:00:00.000Z',
          updatedAt: `2030-01-0${current}T00:00:00.000Z`,
        })),
      }), { status: 200 })
      if (current === 1) return new Promise<Response>((resolve) => { resolveFirst = resolve })
      return Promise.resolve(response())
    }) as unknown as typeof fetch
    const adapter = new ServerSyncAdapter('http://x', fetchImpl)
    const first = withData({ clients: [client('c1', TS1)] })
    const second = withData({ clients: [{ ...client('c1', TS2), name: 'Queued edit' }] })

    const p1 = adapter.saveAll(first)
    const p2 = adapter.saveAll(second)
    resolveFirst!(new Response(JSON.stringify({
      ok: true,
      applied: 1,
      revisions: [{ table: 'clients', id: 'c1', createdAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z' }],
    }), { status: 200 }))
    await Promise.all([p1, p2])

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)
    const queuedWire = batchOps(calls[1]) as unknown as Array<{ row: Client }>
    expect(queuedWire[0].row.name).toBe('Queued edit')
    expect(queuedWire[0].row.updatedAt).toBe('2030-01-01T00:00:00.000Z')
    // Saving the unchanged local object again canonicalizes its acknowledged client revision and
    // does not emit a third, timestamp-only batch.
    await adapter.saveAll(second)
    expect(calls).toHaveLength(2)
  })
})

describe('lifecycle-entity deletes route out of the batch as ARCHIVE-ONLY convergence (DEFECT A)', () => {
  // The server 400-REJECTS a batch DELETE of a lifecycle entity (clients/projects/resources), steering
  // writers at the dedicated lifecycle routes. The old client emitted those deletes IN the batch, so a
  // single undo of a synced create (add client → sync → Cmd-Z) poisoned every later batch until a
  // reload discarded the edits. The adapter now splits lifecycle deletes out and converges each by
  // ARCHIVING ONLY (POST /api/{table}/{id}/archive — action 'write', editor-allowed, never
  // freshness-gated) AFTER the batch. It deliberately does NOT call /delete: soft-delete is
  // irreversible, admin-gated and step-up-gated, so it is never emitted by background sync. The
  // sync-originated disappearance parks the row as ARCHIVED (reversible); it lingers in the archived
  // list (accepted residual). These specs pin that routing and its failure/recovery behaviour.
  const discipline = (updatedAt = TS1): Discipline => ({
    id: 'd1', accountId: 'a1', name: 'Design', sortOrder: 0, createdAt: TS1, updatedAt,
  })
  // Record every request as { url, body } so a spec can assert both the endpoints hit and their order.
  const recordingFetch = (onCall?: (url: string) => Response | null) => {
    const calls: Array<{ url: string; body?: string; keepalive?: boolean }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined, keepalive: init?.keepalive })
      return onCall?.(url) ?? commitReceipt(init)
    }) as unknown as typeof fetch
    return { calls, fetchImpl }
  }
  const opsOf = (call: { body?: string }) => JSON.parse(call.body as string).ops as Array<{ method: string; table: string; id: string }>

  it('(a) undo of a synced create converges via ARCHIVE (no /delete) and does NOT poison later saves', async () => {
    const { calls, fetchImpl } = recordingFetch()
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    // 1) create + sync a client (its PUT rides the batch — a lifecycle PUT is allowed).
    await a.saveAll(scopedData('a1', { clients: [client('c1')] }))
    // 2) undo: c1 is removed. Its delete must NOT ride the batch (that would 400 the whole request);
    //    it converges by archiving through the dedicated archive route instead.
    calls.length = 0
    await a.saveAll(scopedData('a1', {}))
    const urls = calls.map((c) => c.url)
    expect(urls).toContain('http://x/api/clients/c1/archive')
    // the sync layer NEVER hits /delete — soft-delete is not emitted by background sync.
    expect(urls.some((u) => u.endsWith('/clients/c1/delete'))).toBe(false)
    // the archive carries the owning account in its body.
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/clients/c1/archive'))!.body!)).toEqual({ accountId: 'a1' })
    // no batch carried a lifecycle DELETE.
    for (const bc of calls.filter((c) => c.url.endsWith('/api/batch'))) {
      expect(opsOf(bc).some((o) => o.method === 'DELETE' && o.table === 'clients')).toBe(false)
    }

    // 3) a later unrelated edit still syncs — the poison is gone.
    calls.length = 0
    await a.saveAll(scopedData('a1', { clients: [client('c2')] }))
    const put = calls.find((c) => c.url.endsWith('/api/batch'))!
    expect(opsOf(put)).toEqual([expect.objectContaining({ method: 'PUT', table: 'clients', id: 'c2' })])
  })

  it('(b) a batch of ordinary edits plus a lifecycle delete applies the edits (batch first, archive routed out)', async () => {
    const { calls, fetchImpl } = recordingFetch()
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    await a.saveAll(scopedData('a1', { clients: [client('c1')], disciplines: [discipline()] }))

    // Remove the lifecycle client AND edit the discipline in the SAME diff.
    calls.length = 0
    await a.saveAll(scopedData('a1', { disciplines: [discipline(TS2)] }))

    // the discipline edit LANDED via the batch, which never carries the lifecycle delete...
    const batch = calls.find((c) => c.url.endsWith('/api/batch'))!
    expect(opsOf(batch)).toEqual([expect.objectContaining({ method: 'PUT', table: 'disciplines', id: 'd1' })])
    expect(opsOf(batch).some((o) => o.table === 'clients')).toBe(false)
    // ...and the client delete converged by ARCHIVING (no /delete), AFTER the batch (so any
    // reparent/upsert the diff carried lands first).
    const urls = calls.map((c) => c.url)
    expect(urls).toContain('http://x/api/clients/c1/archive')
    expect(urls.some((u) => u.endsWith('/clients/c1/delete'))).toBe(false)
    expect(urls.indexOf('http://x/api/batch')).toBeLessThan(urls.indexOf('http://x/api/clients/c1/archive'))
  })

  it('(c) a lifecycle-ARCHIVE failure surfaces but the batch commits and a later save recovers', async () => {
    let failArchive = true
    const { calls, fetchImpl } = recordingFetch((url) =>
      url.endsWith('/clients/c1/archive') && failArchive ? new Response('nope', { status: 500 }) : null,
    )
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    await a.saveAll(scopedData('a1', { clients: [client('c1')], disciplines: [discipline()] }))

    // Undo the client (lifecycle delete) AND edit the discipline; the archive endpoint is down.
    calls.length = 0
    await expect(a.saveAll(scopedData('a1', { disciplines: [discipline(TS2)] }))).rejects.toThrow(/Lifecycle archive/)
    // The unrelated discipline edit STILL committed — the batch is independent of the stuck archive.
    expect(opsOf(calls.find((c) => c.url.endsWith('/api/batch'))!)).toEqual([
      expect.objectContaining({ method: 'PUT', table: 'disciplines', id: 'd1' }),
    ])

    // A re-save of the SAME target must NOT replay the committed discipline edit (snapshot advanced for
    // the batch), but MUST re-attempt the un-converged client archive (restored to the snapshot).
    failArchive = false // the archive endpoint recovers
    calls.length = 0
    await a.saveAll(scopedData('a1', { disciplines: [discipline(TS2)] }))
    expect(calls.some((c) => c.url.endsWith('/api/batch'))).toBe(false) // discipline edit not replayed
    expect(calls.map((c) => c.url)).toContain('http://x/api/clients/c1/archive')

    // Fully converged now: a further identical save is a clean no-op (no batch, no archive).
    calls.length = 0
    await a.saveAll(scopedData('a1', { disciplines: [discipline(TS2)] }))
    expect(calls).toHaveLength(0)
  })

  it('(d) a lifecycle-ARCHIVE 409 (already archived) is treated as converged, not a poison', async () => {
    // 409 from the archive route = the row is already out of active (a concurrent archive or a
    // converged retry). Surfacing it would re-poison every future diff with a delete that can never
    // "succeed"; instead it advances the snapshot as removed. (404 is handled the same way.)
    const { calls, fetchImpl } = recordingFetch((url) =>
      url.endsWith('/clients/c1/archive') ? new Response(JSON.stringify({ error: 'Already archived' }), { status: 409 }) : null,
    )
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    await a.saveAll(scopedData('a1', { clients: [client('c1')] }))
    calls.length = 0
    await expect(a.saveAll(scopedData('a1', {}))).resolves.toBeUndefined() // 409 → converged, no throw
    // and the row is gone from the snapshot: a further identical save emits nothing.
    calls.length = 0
    await a.saveAll(scopedData('a1', {}))
    expect(calls).toHaveLength(0)
  })

  it('(d2) a lifecycle-ARCHIVE 404 (already gone) is also treated as converged', async () => {
    const { calls, fetchImpl } = recordingFetch((url) =>
      url.endsWith('/clients/c1/archive') ? new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }) : null,
    )
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    await a.saveAll(scopedData('a1', { clients: [client('c1')] }))
    calls.length = 0
    await expect(a.saveAll(scopedData('a1', {}))).resolves.toBeUndefined() // 404 → converged, no throw
    calls.length = 0
    await a.saveAll(scopedData('a1', {}))
    expect(calls).toHaveLength(0)
  })

  it('flushes a pending lifecycle delete on unload as a SINGLE best-effort archive keepalive (no /delete), never poisoning the batch', async () => {
    // FIX 2: dropping the lifecycle delete on unload silently resurrects the row next session (lastSynced
    // is in-memory and dies with the page). Instead we fire a single archive keepalive per pending
    // lifecycle delete (archive-only — one round-trip fits keepalive; a lifecycle DELETE would 400 the
    // keepalive batch, and soft-delete is never emitted by sync).
    const { calls, fetchImpl } = recordingFetch()
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    await a.saveAll(scopedData('a1', { clients: [client('c1')], disciplines: [discipline()] }))

    // Teardown flush with the client removed + the discipline edited.
    calls.length = 0
    await a.saveAll(scopedData('a1', { disciplines: [discipline(TS2)] }), { unload: true })
    // let the fire-and-forget archive keepalive settle.
    await new Promise((resolve) => setTimeout(resolve, 0))

    // the batch still carries ONLY the batch-eligible op, on keepalive — the lifecycle DELETE never
    // poisons it.
    const batchCalls = calls.filter((c) => c.url.endsWith('/api/batch'))
    expect(batchCalls).toHaveLength(1)
    expect(batchCalls[0].keepalive).toBe(true)
    expect(opsOf(batchCalls[0])).toEqual([expect.objectContaining({ method: 'PUT', table: 'disciplines', id: 'd1' })])
    // ...and the pending lifecycle delete fired as a SINGLE keepalive archive (no /delete on unload).
    const archive = calls.find((c) => c.url.endsWith('/clients/c1/archive'))
    expect(archive?.keepalive).toBe(true)
    expect(JSON.parse(archive!.body!)).toEqual({ accountId: 'a1' })
    expect(calls.some((c) => c.url.endsWith('/clients/c1/delete'))).toBe(false) // never soft-deletes on unload
  })
})

describe('atomic large diffs and unload behaviour', () => {
  const manyClients = (n: number) => Array.from({ length: n }, (_, i) => client(`c${i}`))

  it('sends 4500 ordinary UI ops as one ordered transaction', async () => {
    const batches: string[][] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/batch')) {
        batches.push((JSON.parse(init?.body as string) as { ops: Array<{ id: string }> }).ops.map((o) => o.id))
      }
      return commitReceipt(init)
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    const clients = manyClients(4500)
    await a.saveAll(withData({ clients }))

    expect(batches).toHaveLength(1)
    expect(batches[0]).toEqual(clients.map((c) => c.id))
  })

  it('refuses an over-limit diff before sending anything', async () => {
    const fetchImpl = okFetch() as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    const data = withData({ clients: manyClients(MAX_OPS_PER_BATCH + 1) })

    await expect(a.saveAll(data)).rejects.toThrow(`Atomic sync exceeds the ${MAX_OPS_PER_BATCH}-operation server limit.`)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not dispatch a keepalive body over the browser byte budget', async () => {
    const fetchImpl = okFetch() as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    await expect(a.saveAll(withData({ clients: manyClients(1000) }), { unload: true }))
      .rejects.toBeInstanceOf(KeepaliveNotDispatchedError)

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('a small unload flush is one keepalive transaction and includes every (batch-eligible) DELETE', async () => {
    // Lifecycle deletes (clients/projects/resources) deliberately do NOT flush on unload (two-round-trip
    // archive→delete can't complete on a dying page — see the DEFECT A suite). This pins the keepalive
    // path for ORDINARY, batch-eligible deletes, using a scoped non-lifecycle table (disciplines).
    const disc = (id: string): Discipline => ({ id, accountId: 'a1', name: id, sortOrder: 0, createdAt: TS1, updatedAt: TS1 })
    const fetchImpl = okFetch() as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)
    await a.saveAll(withData({ disciplines: [disc('d1'), disc('d2')] }))
    ;(fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear()
    await a.saveAll(emptyAppData(), { unload: true })
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(1)
    expect((calls[0][1] as RequestInit).keepalive).toBe(true)
    expect(batchOps(calls[0]).map((o) => o.method)).toEqual(['DELETE', 'DELETE'])
  })
})

describe('snapshot generation guard (superseded loads / in-flight batches)', () => {
  it('a SUPERSEDED loadAll resolving late does NOT re-seed the snapshot over the newer load', async () => {
    // The cross-account race: switch a1→a2 while a1's slow load is still in flight. persist.ts
    // discards a1's late slice from the STORE (token guard) — the adapter must equally refuse to
    // seed lastSynced from it, or snapshot=a1 under data=a2 and the next save diffs across
    // tenants (DELETEs for a2's rows + PUTs of a1's).
    const a1c = client('c1') // accountId 'a1'
    const a2c: Client = { id: 'c2', accountId: 'a2', name: 'Beta', color: '#3b82f6', createdAt: TS1, updatedAt: TS1 }
    const a1Slice = scopedData('a1', { clients: [a1c] })
    const a2Slice = scopedData('a2', { clients: [a2c] })
    let releaseA1: (() => void) | null = null
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes('accountId=a1')) {
        return new Promise<Response>((resolve) => {
          releaseA1 = () => resolve(new Response(JSON.stringify(a1Slice), { status: 200 }))
        })
      }
      if (String(url).includes('accountId=a2')) return Promise.resolve(new Response(JSON.stringify(a2Slice), { status: 200 }))
      return Promise.resolve(commitReceipt(init))
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    const slowA1 = a.loadAll('a1') // in flight, held open
    await a.loadAll('a2') // newer load wins: snapshot = a2
    releaseA1!()
    await slowA1 // late resolve — must NOT seed a1 over a2
    ;(fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear()

    // An a2 edit must diff against the a2 snapshot: one PUT, and NEVER a delete of a2's rows
    // (which a stale a1 snapshot would produce).
    await a.saveAll(scopedData('a2', { clients: [{ ...a2c, name: 'Beta II', updatedAt: TS2 }] }))
    const ops = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0])
    expect(ops).toEqual([expect.objectContaining({ method: 'PUT', table: 'clients', id: 'c2' })])
  })

  it('an in-flight batch resolving AFTER a reload does not clobber the fresh snapshot seed', async () => {
    // drain() computes its diff, awaits the POST, then advances lastSynced — if a loadAll
    // completed in that window, advancing would overwrite the fresh seed with the pre-reload
    // target (snapshot ≠ store). The generation check makes the reload's seed win; the skipped
    // advance is safe because the server already holds the batch's idempotent ops.
    const slice = scopedData('a1', { clients: [client('c1')] })
    let releaseBatch: (() => void) | null = null
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/batch')) {
        return new Promise<Response>((resolve) => {
          releaseBatch = () => resolve(commitReceipt(init))
        })
      }
      return Promise.resolve(new Response(JSON.stringify(slice), { status: 200 }))
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    const saving = a.saveAll(withData({ clients: [client('cX')] })) // batch held open
    await a.loadAll('a1') // reload completes mid-batch: snapshot = slice (c1)
    releaseBatch!()
    await saving
    ;(fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear()

    // Re-saving the loaded slice must be a no-op — the reload's seed survived the batch settle.
    // (Without the guard, snapshot would be the cX target and this would emit c1/cX ops.)
    await a.saveAll(slice)
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })

  it('a save that STARTS while a loadAll is already in flight cannot clobber that load\'s seed (same-generation race)', async () => {
    // The subtle variant a start-generation check misses: loadAll bumps its counter at fetch
    // START, so a save beginning mid-load captures the same generation the load will seed under.
    // The guard must key on seeds (seedGen), not load starts — otherwise the batch's settle
    // re-advances lastSynced to its pre-reload target, snapshot desyncs from store, and the next
    // save diffs across states (cross-tenant deletes in the switch case).
    const slice = scopedData('a1', { clients: [client('c1')] })
    let releaseState: (() => void) | null = null
    let releaseBatch: (() => void) | null = null
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/batch')) {
        return new Promise<Response>((resolve) => {
          releaseBatch = () => resolve(commitReceipt(init))
        })
      }
      return new Promise<Response>((resolve) => {
        releaseState = () => resolve(new Response(JSON.stringify(slice), { status: 200 }))
      })
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    const loading = a.loadAll('a1') // fetch held — generation already bumped
    const saving = a.saveAll(withData({ clients: [client('cX')] })) // starts mid-load, batch held
    releaseState!() // the load seeds lastSynced = slice
    await loading
    releaseBatch!() // the batch settles AFTER the seed
    await saving
    ;(fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear()

    // The seed survived: re-saving the loaded slice is a no-op.
    await a.saveAll(slice)
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })

  it('a QUEUED save parked before a reload seeded is DROPPED — its diff basis is gone (cross-tenant guard)', async () => {
    // Coalesce-to-latest parks a second save while the first is in flight. If a reload seeds the
    // snapshot before drain picks the parked save up, diffing it against the FRESH seed could
    // emit cross-state ops (DELETEs of rows the parked save's tenant never had). It must be
    // dropped — persist.ts's reload paths surface/re-push whatever edit it carried.
    const slice = scopedData('a1', { clients: [client('c1')] })
    let releaseBatch: (() => void) | null = null
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/batch')) {
        return new Promise<Response>((resolve) => {
          const r = () => resolve(commitReceipt(init))
          if (!releaseBatch) releaseBatch = r
          else r() // only the FIRST batch is held
        })
      }
      return Promise.resolve(new Response(JSON.stringify(slice), { status: 200 }))
    }) as unknown as typeof fetch
    const a = new ServerSyncAdapter('http://x', fetchImpl)

    const save1 = a.saveAll(withData({ clients: [client('cX')] })) // batch 1 held
    const save2 = a.saveAll(withData({ clients: [client('cX'), client('cY')] })) // parked
    await a.loadAll('a1') // reload completes while batch 1 is in flight: seed = slice
    releaseBatch!()
    await Promise.all([save1, save2])

    // Exactly ONE batch went out (the parked save was dropped, never diffed against the seed)…
    const batchCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).endsWith('/api/batch'),
    )
    expect(batchCalls).toHaveLength(1)
    // …and the seed survived: re-saving the loaded slice is a no-op.
    ;(fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear()
    await a.saveAll(slice)
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })
})
