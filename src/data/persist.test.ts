import { describe, it, expect, beforeEach, vi } from 'vitest'
import { attachPersistence, bootstrap, refreshActiveAccountSlice } from './persist'
import { LocalStorageAdapter } from './LocalStorageAdapter'
import { ServerSyncAdapter, BatchConflictError } from './ServerSyncAdapter'
import { LoadError, type PersistenceAdapter } from './PersistenceAdapter'
import { useStore } from '../store/useStore'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import type { AppData } from '@capacitylens/shared/types/entities'
import { seed } from '@capacitylens/shared/data/seed'
import { DEFAULT_ACCOUNT_ID, resetStoreWithAccount } from '../test/fixtures'

beforeEach(() => {
  localStorage.clear()
  // Seeds a single account AND makes it active, so the add* calls below
  // (which now require an active account) work.
  resetStoreWithAccount()
})

describe('attachPersistence', () => {
  it('persists data changes (immediate mode)', async () => {
    const adapter = new LocalStorageAdapter('capacitylens/persist-a')
    const detach = attachPersistence(useStore, adapter, 0)
    useStore.getState().addClient({ name: 'Acme', color: '#1' })
    const loaded = await adapter.loadAll()
    expect(loaded.clients).toHaveLength(1)
    detach()
  })

  it('stops persisting after detach', async () => {
    const adapter = new LocalStorageAdapter('capacitylens/persist-b')
    const detach = attachPersistence(useStore, adapter, 0)
    detach()
    useStore.getState().addClient({ name: 'Acme', color: '#1' })
    expect(await adapter.loadAll()).toEqual(emptyAppData())
  })

  it('flushes a pending debounced write on pagehide (so a tab close does not lose it)', async () => {
    const adapter = new LocalStorageAdapter('capacitylens/persist-flush')
    const detach = attachPersistence(useStore, adapter, 300) // debounced, NOT immediate
    useStore.getState().addClient({ name: 'Acme', color: '#1' })
    expect((await adapter.loadAll()).clients).toHaveLength(0) // still inside the debounce window
    window.dispatchEvent(new Event('pagehide'))
    expect((await adapter.loadAll()).clients).toHaveLength(1) // flushed synchronously
    detach()
  })

  it('reports a failed write via onError, then a recovered write via onSuccess', async () => {
    // A transient write failure (e.g. server unreachable) should fire onError; the
    // next successful write must fire onSuccess so the caller can clear the banner.
    const adapter = new LocalStorageAdapter('capacitylens/persist-recover')
    const realSave = adapter.saveAll.bind(adapter)
    let calls = 0
    vi.spyOn(adapter, 'saveAll').mockImplementation(async (d) => {
      calls += 1
      if (calls === 1) throw new Error('write unavailable')
      return realSave(d)
    })
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const detach = attachPersistence(useStore, adapter, 0, onError, onSuccess)

    useStore.getState().addClient({ name: 'A', color: '#111111' })
    await new Promise((r) => setTimeout(r, 5))
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onSuccess).not.toHaveBeenCalled()

    useStore.getState().addClient({ name: 'B', color: '#222222' })
    await new Promise((r) => setTimeout(r, 5))
    expect(onSuccess).toHaveBeenCalled()
    detach()
  })

  it('retries a failed write in the background without waiting for another edit', async () => {
    // Server-backed mode has no localStorage fallback: if a write fails and the user
    // reloads before their next edit, unsynced changes would be lost. A bounded
    // background retry (re-sending the latest store state) self-heals once the
    // adapter recovers — proven here with a one-shot failure + a short backoff.
    vi.useFakeTimers()
    try {
      const adapter = new LocalStorageAdapter('capacitylens/persist-retry')
      const realSave = adapter.saveAll.bind(adapter)
      let calls = 0
      vi.spyOn(adapter, 'saveAll').mockImplementation(async (d) => {
        calls += 1
        if (calls === 1) throw new Error('temporarily unavailable')
        return realSave(d)
      })
      const onSuccess = vi.fn()
      const detach = attachPersistence(useStore, adapter, 0, undefined, onSuccess)

      useStore.getState().addClient({ name: 'Retry Me', color: '#333333' })
      await vi.advanceTimersByTimeAsync(0) // first attempt → fails, schedules retry
      expect(calls).toBe(1)
      expect(onSuccess).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1000) // backoff #1 (2^0 * 1000ms) → succeeds
      expect(calls).toBe(2)
      expect(onSuccess).toHaveBeenCalled()
      expect((await adapter.loadAll()).clients.some((c) => c.name === 'Retry Me')).toBe(true)
      detach()
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-attempts a write stranded after the retry budget is spent when the browser comes back online', async () => {
    // The bounded retry budget stops a PERMANENTLY-failing write from retrying forever, but a
    // mere network outage shouldn't strand the delta until the next edit: an `online` event
    // re-attempts it with a fresh budget (so a reload after recovery doesn't lose it).
    vi.useFakeTimers()
    try {
      const adapter = new LocalStorageAdapter('capacitylens/persist-online')
      const realSave = adapter.saveAll.bind(adapter)
      let online = false
      vi.spyOn(adapter, 'saveAll').mockImplementation(async (d) => {
        if (!online) throw new Error('offline')
        return realSave(d)
      })
      const onSuccess = vi.fn()
      const detach = attachPersistence(useStore, adapter, 0, undefined, onSuccess)

      useStore.getState().addClient({ name: 'Stranded', color: '#444444' })
      await vi.advanceTimersByTimeAsync(0) // initial attempt fails
      await vi.advanceTimersByTimeAsync(60_000) // 1+2+4+8+16s backoffs all fail → budget exhausted
      expect(onSuccess).not.toHaveBeenCalled()

      // A bare `online` while still failing would also be gated by failedSinceSuccess; here
      // the connection truly returns, so the re-attempt lands.
      online = true
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(0)
      expect(onSuccess).toHaveBeenCalled()
      expect((await adapter.loadAll()).clients.some((c) => c.name === 'Stranded')).toBe(true)
      detach()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does NOT re-write on an online event when nothing is stranded (no needless full rewrite)', async () => {
    const adapter = new LocalStorageAdapter('capacitylens/persist-online-noop')
    const saveAll = vi.spyOn(adapter, 'saveAll')
    const detach = attachPersistence(useStore, adapter, 0)
    useStore.getState().addClient({ name: 'Synced', color: '#555555' })
    await new Promise((r) => setTimeout(r, 5))
    const callsAfterSync = saveAll.mock.calls.length
    // No prior failure → an online event is a no-op (gated on failedSinceSuccess).
    window.dispatchEvent(new Event('online'))
    await new Promise((r) => setTimeout(r, 5))
    expect(saveAll.mock.calls.length).toBe(callsAfterSync)
    detach()
  })
})

describe('account-switch orchestrator (P1.13, server mode)', () => {
  // The §5 correctness core at the persist layer: a tenant switch hydrates THAT account's slice and
  // re-seeds the adapter's diff snapshot atomically, with NO spurious save of the loaded slice.

  it('loads the picked account slice into the store and does NOT push it back as a save', async () => {
    const a2Slice = {
      ...emptyAppData(),
      accounts: [{ id: 'a2', name: 'Beta', color: '#1', createdAt: 't', updatedAt: 't' }],
      clients: [{ id: 'c2', accountId: 'a2', name: 'Beta Client', color: '#1', createdAt: 't', updatedAt: 't' }],
    }
    const loadAll = vi.fn(async (accountId?: string) => (accountId === 'a2' ? a2Slice : emptyAppData()))
    const saveAll = vi.fn().mockResolvedValue(undefined)
    const adapter: PersistenceAdapter = { loadAll, saveAll }

    // Server-mode attach with an empty store (the pre-pick state in auth-on).
    useStore.getState().replaceAll(emptyAppData())
    useStore.getState().setActiveAccount(null)
    useStore.getState().setAccountSummaries([{ id: 'a2', name: 'Beta', role: 'owner' }])
    const detach = attachPersistence(useStore, adapter, 0, undefined, undefined, true)

    // Pick a2 (existence via the summary) → the orchestrator loads a2's slice.
    useStore.getState().setActiveAccount('a2')
    await new Promise((r) => setTimeout(r, 5))

    expect(loadAll).toHaveBeenCalledWith('a2') // per-account hydration
    expect(useStore.getState().data.clients.map((c) => c.id)).toEqual(['c2']) // slice loaded into the store
    // The slice load must NOT read as a user edit → no save of the loaded slice.
    expect(saveAll).not.toHaveBeenCalled()
    detach()
  })

  it('a genuine edit AFTER a switch still saves (the guard only suppresses the slice load)', async () => {
    const a2Slice = {
      ...emptyAppData(),
      accounts: [{ id: 'a2', name: 'Beta', color: '#1', createdAt: 't', updatedAt: 't' }],
    }
    const loadAll = vi.fn(async () => a2Slice)
    const saveAll = vi.fn().mockResolvedValue(undefined)
    const adapter: PersistenceAdapter = { loadAll, saveAll }

    useStore.getState().replaceAll(emptyAppData())
    useStore.getState().setActiveAccount(null)
    useStore.getState().setAccountSummaries([{ id: 'a2', name: 'Beta', role: 'owner' }])
    const detach = attachPersistence(useStore, adapter, 0, undefined, undefined, true)

    useStore.getState().setActiveAccount('a2')
    await new Promise((r) => setTimeout(r, 5))
    expect(saveAll).not.toHaveBeenCalled() // the load itself didn't save

    // A real edit in the now-active account DOES save.
    useStore.getState().addClient({ name: 'New Client', color: '#222222' })
    await new Promise((r) => setTimeout(r, 5))
    expect(saveAll).toHaveBeenCalledTimes(1)
    detach()
  })

  it("FLUSHES (does not drop) account A's pending debounced edits before loading B's slice", async () => {
    // Regression guard for the data-loss edge (P1.13): a user edits account A and switches to B
    // WITHIN the debounce window. The orchestrator used to clearTimeout + pending=null, silently
    // DROPPING A's last edit. It must instead FLUSH that pending write while data===A AND the diff
    // snapshot===A (so the diff is A-vs-A, correct), landing it BEFORE B's slice load reseeds the
    // snapshot to B — never a cross-account diff. Uses the REAL ServerSyncAdapter so the actual
    // diff/snapshot logic runs against a fake fetch; we assert on the wire traffic.
    const aSlice = {
      ...emptyAppData(),
      accounts: [{ id: 'a1', name: 'Alpha', color: '#1', createdAt: 't', updatedAt: 't' }],
    }
    const bSlice = {
      ...emptyAppData(),
      accounts: [{ id: 'b1', name: 'Beta', color: '#1', createdAt: 't', updatedAt: 't' }],
    }
    type Wire = {
      url: string
      ops?: Array<{ method: string; table: string; id: string; accountId?: string; row?: { accountId?: string } }>
    }
    const wire: Wire[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/state')) {
        wire.push({ url: u })
        return new Response(JSON.stringify(u.includes('accountId=b1') ? bSlice : aSlice), { status: 200 })
      }
      // /api/batch — capture the ops carried on the wire.
      const body = JSON.parse(String(init?.body)) as { ops: Wire['ops'] }
      wire.push({ url: u, ops: body.ops })
      return new Response('{}', { status: 200 })
    })
    const adapter = new ServerSyncAdapter('http://api.test', fetchImpl as unknown as typeof fetch)

    useStore.getState().replaceAll(emptyAppData())
    useStore.getState().setActiveAccount(null)
    useStore.getState().setAccountSummaries([
      { id: 'a1', name: 'Alpha', role: 'owner' },
      { id: 'b1', name: 'Beta', role: 'owner' },
    ])
    const detach = attachPersistence(useStore, adapter, 300, undefined, undefined, true) // genuinely debounced

    // Pick A → orchestrator hydrates A's slice (snapshot := A).
    useStore.getState().setActiveAccount('a1')
    await new Promise((r) => setTimeout(r, 5))
    expect(useStore.getState().activeAccountId).toBe('a1')

    // Genuine edit to A → DEBOUNCED (not yet on the wire). Capture its id to find it later.
    const edited = useStore.getState().addClient({ name: 'A only', color: '#222222' })
    expect(wire.some((w) => w.ops)).toBe(false) // nothing flushed yet — still inside the 300ms window

    // Switch to B BEFORE the debounce timer fires → must FLUSH A's edit, then load B.
    useStore.getState().setActiveAccount('b1')
    await new Promise((r) => setTimeout(r, 20)) // < 300ms, so a dropped edit would NOT have its timer fire

    // A's edit reached the adapter (flushed, not dropped): a batch carrying A's client (a PUT, so
    // its accountId rides on the row — DELETEs carry a top-level accountId, PUTs carry the full row).
    const carriesA = (o: NonNullable<Wire['ops']>[number]) => o.row?.accountId === 'a1' || o.accountId === 'a1'
    const aBatchIdx = wire.findIndex((w) => w.ops?.some((o) => o.id === edited.id && carriesA(o)))
    expect(aBatchIdx).toBeGreaterThanOrEqual(0)
    // And it landed BEFORE B's slice load (no window where a diff could cross accounts).
    const bLoadIdx = wire.findIndex((w) => w.url.includes('accountId=b1'))
    expect(bLoadIdx).toBeGreaterThanOrEqual(0)
    expect(aBatchIdx).toBeLessThan(bLoadIdx)

    // After B loaded, NO batch carries A's ops (no cross-account diff B-vs-A).
    const afterB = wire.slice(bLoadIdx)
    expect(afterB.some((w) => w.ops?.some(carriesA))).toBe(false)
    expect(useStore.getState().activeAccountId).toBe('b1')
    detach()
  })

  it('is INERT in the demo build — a switch does NOT call loadAll(accountId)', async () => {
    const loadAll = vi.fn(async () => emptyAppData())
    const saveAll = vi.fn().mockResolvedValue(undefined)
    const adapter: PersistenceAdapter = { loadAll, saveAll }

    useStore.getState().replaceAll(makeLocalTwoAccounts())
    useStore.getState().setActiveAccount('a1')
    const detach = attachPersistence(useStore, adapter, 0, undefined, undefined, false) // demo build

    useStore.getState().setActiveAccount('a2')
    await new Promise((r) => setTimeout(r, 5))
    // Demo build: data already holds all accounts, so the orchestrator never fetches a slice.
    expect(loadAll).not.toHaveBeenCalled()
    detach()
  })
})

function makeLocalTwoAccounts() {
  return {
    ...emptyAppData(),
    accounts: [
      { id: 'a1', name: 'Alpha', color: '#1', createdAt: 't', updatedAt: 't' },
      { id: 'a2', name: 'Beta', color: '#1', createdAt: 't', updatedAt: 't' },
    ],
  }
}

// ── Shared server-mode refresh helpers ────────────────────────────────────────────────────────────
// Used by the refresh-on-focus, refreshActiveAccountSlice, and batch-conflict suites (hoisted so the
// three don't carry verbatim copies).

/** A recording adapter whose loadAll serves a fixed slice for the active account. */
function recordingAdapter(slice: AppData) {
  const loadAll = vi.fn(async (): Promise<AppData> => slice)
  const saveAll = vi.fn().mockResolvedValue(undefined)
  const adapter: PersistenceAdapter = { loadAll, saveAll }
  return { adapter, loadAll, saveAll }
}

const a2Slice = (): AppData => ({
  ...emptyAppData(),
  accounts: [{ id: 'a2', name: 'Beta', color: '#1', createdAt: 't', updatedAt: 't' }],
  clients: [{ id: 'c2', accountId: 'a2', name: 'Beta Client', color: '#1', createdAt: 't', updatedAt: 't' }],
})

/** Server-mode attach with a2 already the active account (post-pick steady state). */
async function attachActiveA2(
  adapter: PersistenceAdapter,
  debounceMs = 0,
  onError?: (e: unknown) => void,
  onSuccess?: () => void,
) {
  useStore.getState().replaceAll(emptyAppData())
  useStore.getState().setActiveAccount(null)
  useStore.getState().setAccountSummaries([{ id: 'a2', name: 'Beta', role: 'owner' }])
  const detach = attachPersistence(useStore, adapter, debounceMs, onError, onSuccess, true)
  useStore.getState().setActiveAccount('a2') // hydrates a2, seeds snapshot := a2
  await new Promise((r) => setTimeout(r, 5))
  return detach
}

describe('refresh-on-focus (P1.16, server mode)', () => {
  // Coming back to the tab/window re-hydrates the active account's slice by REUSING refreshActive
  // (the switch orchestrator's body) — so the adapter's private lastSynced snapshot is re-seeded
  // atomically with `data`. Proven here against a recording adapter + window 'focus' events (the
  // same shape as the pagehide tests above). Uses the module-scope recordingAdapter / a2Slice /
  // attachActiveA2 helpers (shared with the refreshActiveAccountSlice + batch-conflict suites).

  it('re-hydrates the active slice on focus + re-seeds the snapshot (a later save diffs to ZERO ops)', async () => {
    const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice())
    const detach = await attachActiveA2(adapter)
    const loadsAfterPick = loadAll.mock.calls.length // the switch already loaded once
    saveAll.mockClear()

    window.dispatchEvent(new Event('focus'))
    await new Promise((r) => setTimeout(r, 5))

    expect(loadAll).toHaveBeenCalledWith('a2') // re-hydrated the active account
    expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1)
    // The re-hydration re-seeds lastSynced atomically: loading the same slice it already holds is
    // NOT a user edit, so it must NOT push a save back.
    expect(saveAll).not.toHaveBeenCalled()
    detach()
  })

  it('THROTTLES — two focus events inside the interval call loadAll once', async () => {
    const { adapter, loadAll } = recordingAdapter(a2Slice())
    const detach = await attachActiveA2(adapter)
    const before = loadAll.mock.calls.length

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus')) // immediately again — inside the 30s window
    await new Promise((r) => setTimeout(r, 5))

    expect(loadAll.mock.calls.length).toBe(before + 1) // throttled to a single refetch
    detach()
  })

  it('SKIPS refresh when there is no active account (on the picker)', async () => {
    const { adapter, loadAll } = recordingAdapter(a2Slice())
    useStore.getState().replaceAll(emptyAppData())
    useStore.getState().setActiveAccount(null)
    useStore.getState().setAccountSummaries([{ id: 'a2', name: 'Beta', role: 'owner' }])
    const detach = attachPersistence(useStore, adapter, 0, undefined, undefined, true)
    // No account picked → still on the picker.
    loadAll.mockClear()

    window.dispatchEvent(new Event('focus'))
    await new Promise((r) => setTimeout(r, 5))

    expect(loadAll).not.toHaveBeenCalled() // nothing to refresh
    detach()
  })

  it('FLUSHES a pending debounced edit BEFORE the focus refetch (user edit lands first)', async () => {
    // The unsaved-edit safety: a pending debounced edit + a focus must POST that edit BEFORE loadAll
    // re-seeds the snapshot (last-writer-wins, user wins). Order-assert on the recorded call sequence.
    const order: string[] = []
    const loadAll = vi.fn(async () => {
      order.push('loadAll')
      return a2Slice()
    })
    const saveAll = vi.fn(async () => {
      order.push('saveAll')
    })
    const adapter: PersistenceAdapter = { loadAll, saveAll }
    const detach = await attachActiveA2(adapter, 300) // genuinely debounced
    order.length = 0 // ignore the initial switch's loadAll

    useStore.getState().addClient({ name: 'Unsaved', color: '#222222' }) // debounced — not yet on the wire
    expect(saveAll).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('focus'))
    await new Promise((r) => setTimeout(r, 20)) // < 300ms: a dropped edit's timer would NOT fire

    // The edit's save flushed BEFORE the refresh loadAll (no cross-account / lost-edit window).
    expect(order[0]).toBe('saveAll')
    expect(order).toContain('loadAll')
    expect(order.indexOf('saveAll')).toBeLessThan(order.indexOf('loadAll'))
    detach()
  })

  it('is INERT in the demo build — focus does NOT call loadAll', async () => {
    const { adapter, loadAll } = recordingAdapter(a2Slice())
    useStore.getState().replaceAll(makeLocalTwoAccounts())
    useStore.getState().setActiveAccount('a1')
    const detach = attachPersistence(useStore, adapter, 0, undefined, undefined, false) // demo build
    loadAll.mockClear()

    window.dispatchEvent(new Event('focus'))
    await new Promise((r) => setTimeout(r, 5))

    expect(loadAll).not.toHaveBeenCalled() // local holds every account — no refetch
    detach()
  })

  it('ABORTS the focus refresh while a save is FAILED — the un-persisted edit must not be clobbered', async () => {
    // The data-loss trap: an edit's save fails (retry scheduled), the user tabs away and back, and the
    // focus refresh loadAll+replaceAll's the SERVER's copy over the optimistic state — re-seeding the
    // snapshot so the pending retry diffs to ZERO ops, "succeeds", and the edit is silently gone
    // forever. The refresh must abort instead: the retry machinery still holds the edit, and the
    // persist banner (onError) already tells the user they're unsynced.
    const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice())
    const detach = await attachActiveA2(adapter) // debounceMs 0 — saves fire immediately
    const loadsAfterPick = loadAll.mock.calls.length
    saveAll.mockRejectedValue(new Error('write unavailable')) // every save now fails

    useStore.getState().addClient({ name: 'Unsynced', color: '#222222' })
    await new Promise((r) => setTimeout(r, 5)) // let the immediate save fail (failedSinceSuccess set)

    window.dispatchEvent(new Event('focus'))
    await new Promise((r) => setTimeout(r, 5))

    expect(loadAll.mock.calls.length).toBe(loadsAfterPick) // NO reload — the refresh aborted
    // The optimistic edit is still in the store, available to the retry/stranded-write machinery.
    expect(useStore.getState().data.clients.some((c) => c.name === 'Unsynced')).toBe(true)
    detach()
  })
})

describe('refreshActiveAccountSlice (the lifecycle hook reload seam)', () => {
  // The out-of-band server writers (archive/delete/purge routes) reload the active slice THROUGH the
  // orchestrator via this export — a bare loadAll+replaceAll would clobber a still-debounced edit and
  // re-seed the snapshot under it (the same permanent-loss mechanism the focus-refresh abort guards).
  // Uses the module-scope recordingAdapter / a2Slice / attachActiveA2 helpers.

  it('returns false when no orchestrator is attached (the caller falls back to a bare reload)', async () => {
    expect(await refreshActiveAccountSlice('a2')).toBe(false)
  })

  it('FLUSHES a pending debounced edit BEFORE reloading (returns true; the edit lands first)', async () => {
    const order: string[] = []
    const loadAll = vi.fn(async () => {
      order.push('loadAll')
      return a2Slice()
    })
    const saveAll = vi.fn(async () => {
      order.push('saveAll')
    })
    const adapter: PersistenceAdapter = { loadAll, saveAll }
    const detach = await attachActiveA2(adapter, 300) // genuinely debounced
    order.length = 0 // ignore the initial switch's loadAll

    useStore.getState().addClient({ name: 'Mid-debounce', color: '#222222' }) // not yet on the wire
    expect(await refreshActiveAccountSlice('a2')).toBe(true)

    expect(order[0]).toBe('saveAll') // the edit POSTed before the reload re-seeded the snapshot
    expect(order).toContain('loadAll')
    detach()
  })

  it('SKIPS the reload when the flush FAILS — preserving the edit beats reflecting the mutation', async () => {
    const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice())
    const detach = await attachActiveA2(adapter, 300)
    const loadsAfterPick = loadAll.mock.calls.length
    saveAll.mockRejectedValue(new Error('write unavailable'))

    useStore.getState().addClient({ name: 'Unsynced', color: '#222222' })
    expect(await refreshActiveAccountSlice('a2')).toBe(true) // handled by the orchestrator…

    expect(loadAll.mock.calls.length).toBe(loadsAfterPick) // …which refused to clobber the edit
    expect(useStore.getState().data.clients.some((c) => c.name === 'Unsynced')).toBe(true)
    detach()
  })

  it('with a STALE id is a no-op and does NOT cancel an in-flight newer switch (wrong-tenant race)', async () => {
    // The P1 race: a lifecycle POST for account A resolves AFTER the user switched A→B while B's
    // slice load is still on the wire. Pre-fix, the stale refreshActive(A) bumped the switch token —
    // CANCELLING B's late-resolving load — then installed A's slice while activeAccountId === B
    // (cross-tenant display → cross-tenant writes). The entry guard must make the stale call a
    // pure no-op: no loadAll(A), no token bump, and B's held-open load still lands.
    const aSlice: AppData = {
      ...emptyAppData(),
      accounts: [{ id: 'a1', name: 'Alpha', color: '#1', createdAt: 't', updatedAt: 't' }],
      clients: [{ id: 'ca', accountId: 'a1', name: 'Alpha Client', color: '#1', createdAt: 't', updatedAt: 't' }],
    }
    const bSlice: AppData = {
      ...emptyAppData(),
      accounts: [{ id: 'b1', name: 'Beta', color: '#1', createdAt: 't', updatedAt: 't' }],
      clients: [{ id: 'cb', accountId: 'b1', name: 'Beta Client', color: '#1', createdAt: 't', updatedAt: 't' }],
    }
    let releaseB: (() => void) | null = null
    const loadAll = vi.fn((accountId?: string): Promise<AppData> => {
      if (accountId === 'b1') {
        // Hold B's slice load open so the stale refresh races it mid-flight.
        return new Promise<AppData>((resolve) => {
          releaseB = () => resolve(bSlice)
        })
      }
      return Promise.resolve(aSlice)
    })
    const saveAll = vi.fn().mockResolvedValue(undefined)
    const adapter: PersistenceAdapter = { loadAll, saveAll }

    useStore.getState().replaceAll(emptyAppData())
    useStore.getState().setActiveAccount(null)
    useStore.getState().setAccountSummaries([
      { id: 'a1', name: 'Alpha', role: 'owner' },
      { id: 'b1', name: 'Beta', role: 'owner' },
    ])
    const detach = attachPersistence(useStore, adapter, 0, undefined, undefined, true)

    useStore.getState().setActiveAccount('a1') // hydrate A
    await new Promise((r) => setTimeout(r, 5))
    expect(useStore.getState().data.clients.map((c) => c.id)).toEqual(['ca'])

    useStore.getState().setActiveAccount('b1') // switch — B's load is now held open
    await new Promise((r) => setTimeout(r, 5))
    expect(releaseB).not.toBeNull() // B's loadAll dispatched, unresolved
    const aLoadsBefore = loadAll.mock.calls.filter((c) => c[0] === 'a1').length

    // The lifecycle hook's stale reload lands NOW (mutation ran in A; user is on B).
    expect(await refreshActiveAccountSlice('a1')).toBe(true) // orchestrator handled it…
    expect(loadAll.mock.calls.filter((c) => c[0] === 'a1').length).toBe(aLoadsBefore) // …as a no-op

    // B's in-flight load was NOT cancelled: when it resolves, B's slice still lands.
    releaseB!()
    await new Promise((r) => setTimeout(r, 5))
    expect(useStore.getState().activeAccountId).toBe('b1')
    expect(useStore.getState().data.clients.map((c) => c.id)).toEqual(['cb']) // B's slice, never A's
    detach()
  })

  it('is UNREGISTERED after detach (a later call falls back)', async () => {
    const { adapter } = recordingAdapter(a2Slice())
    const detach = await attachActiveA2(adapter)
    detach()
    expect(await refreshActiveAccountSlice('a2')).toBe(false)
  })
})

describe('batch-conflict resolution (server wins — interim policy until a conflict UI exists)', () => {
  // A 409 from /api/batch (optimistic concurrency) is NOT transient: retrying the same stale diff
  // 409s forever, and abortIfSaveFailed blocks the focus refresh that could break the loop — a
  // self-sustaining error wedge. The persist layer must instead resolve by RELOADING the active
  // slice (server wins, the local conflicting edit is deliberately discarded), surface the banner
  // via onError, and clear it via the follow-up clean save's onSuccess.

  it('a 409 conflict RELOADS the slice (no abort), does NOT arm the stale-diff retry, and the banner clears', async () => {
    vi.useFakeTimers()
    try {
      const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice())
      const onError = vi.fn()
      const onSuccess = vi.fn()
      const detachP = attachActiveA2(adapter, 0, onError, onSuccess)
      await vi.advanceTimersByTimeAsync(5)
      const detach = await detachP
      const loadsAfterPick = loadAll.mock.calls.length
      saveAll.mockClear()
      saveAll.mockRejectedValueOnce(new BatchConflictError('stale write'))

      useStore.getState().addClient({ name: 'Conflicted', color: '#222222' }) // immediate save → 409
      await vi.advanceTimersByTimeAsync(5)

      expect(onError).toHaveBeenCalledTimes(1) // the banner surfaced "your edit did not save"
      // The resolution reload ran — deliberately WITHOUT abortIfSaveFailed (this reload IS the
      // resolution), unlike the focus refresh which must abort on a failed save.
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1)
      // Server wins: the conflicting local edit was discarded for the server's slice.
      expect(useStore.getState().data.clients.map((c) => c.id)).toEqual(['c2'])
      // The follow-up clean save fired onSuccess so the banner comes back down.
      expect(onSuccess).toHaveBeenCalled()

      // The backoff retry was NOT armed with the stale diff: 35s covers every backoff step.
      const savesAfterResolution = saveAll.mock.calls.length // the conflict save + the follow-up
      expect(savesAfterResolution).toBe(2)
      await vi.advanceTimersByTimeAsync(35_000)
      expect(saveAll.mock.calls.length).toBe(savesAfterResolution)
      detach()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a conflict DURING the resolution does not recurse — ONE reload, banner stays up', async () => {
    // The re-entry guard: the resolution's follow-up save can itself 409 (other pending edits also
    // stale). That must NOT trigger a second resolution reload (an unbounded reload↔save loop) —
    // it just surfaces the banner; a later focus/online re-attempt retriggers resolution.
    vi.useFakeTimers()
    try {
      const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice())
      const onError = vi.fn()
      const onSuccess = vi.fn()
      const detachP = attachActiveA2(adapter, 0, onError, onSuccess)
      await vi.advanceTimersByTimeAsync(5)
      const detach = await detachP
      const loadsAfterPick = loadAll.mock.calls.length
      saveAll.mockClear()
      saveAll
        .mockRejectedValueOnce(new BatchConflictError('stale write')) // the edit's save
        .mockRejectedValueOnce(new BatchConflictError('still stale')) // the resolution's follow-up save

      useStore.getState().addClient({ name: 'Conflicted', color: '#222222' })
      await vi.advanceTimersByTimeAsync(5)

      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1) // exactly ONE resolution reload
      expect(onError).toHaveBeenCalledTimes(2) // both conflicts surfaced
      expect(onSuccess).not.toHaveBeenCalled() // banner stays up — nothing landed
      await vi.advanceTimersByTimeAsync(35_000) // and no retry/reload machinery re-fires
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1)
      expect(saveAll.mock.calls.length).toBe(2)
      detach()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a NON-conflict failure keeps the existing backoff retry (regression pin) — no conflict reload', async () => {
    vi.useFakeTimers()
    try {
      const { adapter, loadAll, saveAll } = recordingAdapter(a2Slice())
      const onSuccess = vi.fn()
      const detachP = attachActiveA2(adapter, 0, undefined, onSuccess)
      await vi.advanceTimersByTimeAsync(5)
      const detach = await detachP
      const loadsAfterPick = loadAll.mock.calls.length
      saveAll.mockClear()
      saveAll.mockRejectedValueOnce(new Error('temporarily unavailable'))

      useStore.getState().addClient({ name: 'Transient', color: '#222222' })
      await vi.advanceTimersByTimeAsync(0) // first attempt fails, retry armed
      expect(onSuccess).not.toHaveBeenCalled()
      expect(loadAll.mock.calls.length).toBe(loadsAfterPick) // a transient failure never reloads

      await vi.advanceTimersByTimeAsync(1000) // backoff #1 → succeeds
      expect(onSuccess).toHaveBeenCalled()
      // The optimistic edit survived (no server-wins reload for a transient failure).
      expect(useStore.getState().data.clients.some((c) => c.name === 'Transient')).toBe(true)
      detach()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('bootstrap', () => {
  it('seeds an empty store and marks it hydrated', async () => {
    const adapter = new LocalStorageAdapter('capacitylens/persist-c')
    const detach = await bootstrap(useStore, adapter, { debounceMs: 0, seedIfEmpty: seed() })
    expect(useStore.getState().hydrated).toBe(true)
    expect(useStore.getState().data.resources.length).toBeGreaterThan(0)
    // the seed is also persisted on first run
    expect((await adapter.loadAll()).resources.length).toBeGreaterThan(0)
    detach()
  })

  it('does not re-seed after the user has cleared all their data', async () => {
    const adapter = new LocalStorageAdapter('capacitylens/persist-cleared')
    await adapter.saveAll(emptyAppData()) // user deleted everything; empty IS persisted
    const detach = await bootstrap(useStore, adapter, { debounceMs: 0, seedIfEmpty: seed() })
    expect(useStore.getState().data.resources).toHaveLength(0) // seed must NOT come back
    detach()
  })

  it('a failing first-run seed write still hydrates, reports via onError, and attaches persistence', async () => {
    const adapter = new LocalStorageAdapter('capacitylens/persist-seedfail')
    const realSave = adapter.saveAll.bind(adapter)
    let calls = 0
    const errors: unknown[] = []
    vi.spyOn(adapter, 'saveAll').mockImplementation(async (d) => {
      calls += 1
      if (calls === 1) throw new Error('quota exceeded') // the seed write fails
      return realSave(d)
    })

    const detach = await bootstrap(useStore, adapter, { debounceMs: 0, seedIfEmpty: seed(), onError: (e) => errors.push(e) })

    expect(useStore.getState().hydrated).toBe(true) // app still renders
    expect(errors).toHaveLength(1) // the failure surfaced (would flip the banner)
    // persistence is STILL attached: a later edit persists via the (now-working) adapter.
    useStore.getState().addClient({ name: 'Later', color: '#1' })
    expect((await adapter.loadAll()).clients.some((c) => c.name === 'Later')).toBe(true)
    detach()
  })

  it('loads existing data without re-seeding', async () => {
    const adapter = new LocalStorageAdapter('capacitylens/persist-d')
    await adapter.saveAll({ ...emptyAppData(), clients: [{ id: 'c1', accountId: DEFAULT_ACCOUNT_ID, createdAt: 't', updatedAt: 't', name: 'Saved', color: '#1' }] })
    const detach = await bootstrap(useStore, adapter, { debounceMs: 0, seedIfEmpty: seed() })
    expect(useStore.getState().data.clients).toHaveLength(1)
    expect(useStore.getState().data.clients[0].name).toBe('Saved')
    expect(useStore.getState().data.resources).toHaveLength(0)
    detach()
  })

  it('keeps loaded data and attaches persistence when hasExisting() throws after a successful load', async () => {
    // Server mode: /api/state succeeds but /api/meta has a transient blip. The loaded data
    // must NOT be discarded and saving must NOT be bricked by the hasExisting() throw.
    const loaded = {
      ...emptyAppData(),
      clients: [{ id: 'c1', accountId: DEFAULT_ACCOUNT_ID, createdAt: 't', updatedAt: 't', name: 'Loaded', color: '#1' }],
    }
    const saveAll = vi.fn().mockResolvedValue(undefined)
    const adapter: PersistenceAdapter = {
      loadAll: () => Promise.resolve(loaded),
      saveAll,
      hasExisting: () => Promise.reject(new Error('meta blip')),
    }

    const detach = await bootstrap(useStore, adapter, { debounceMs: 0, seedIfEmpty: seed() })

    expect(useStore.getState().hydrated).toBe(true)
    expect(useStore.getState().data.clients).toHaveLength(1) // loaded data kept, not discarded
    expect(useStore.getState().data.clients[0].name).toBe('Loaded')
    expect(useStore.getState().data.resources).toHaveLength(0) // NOT re-seeded (data exists)

    // Persistence IS attached: a later edit still saves.
    useStore.getState().addClient({ name: 'Later', color: '#222222' })
    await new Promise((r) => setTimeout(r, 5))
    expect(saveAll).toHaveBeenCalled()
    detach()
  })

  it('flags loadError and refuses to seed/save over corrupt stored data', async () => {
    const KEY = 'capacitylens/persist-corrupt'
    localStorage.setItem(KEY, '{ not valid json') // unreadable-but-present bytes
    const adapter = new LocalStorageAdapter(KEY)
    useStore.getState().setLoadError(false)

    const detach = await bootstrap(useStore, adapter, { debounceMs: 0, seedIfEmpty: seed() })

    expect(useStore.getState().loadError).toBe(true)
    expect(useStore.getState().hydrated).toBe(true)
    expect(useStore.getState().data.resources).toHaveLength(0) // rendered empty, not seeded
    expect(localStorage.getItem(KEY)).toBe('{ not valid json') // corrupt bytes untouched

    // No autosave attached: a later mutation must not write over the corrupt data.
    useStore.getState().addAccount({ name: 'New', color: '#111111' })
    await new Promise((r) => setTimeout(r, 5))
    expect(localStorage.getItem(KEY)).toBe('{ not valid json')

    useStore.getState().setLoadError(false)
    detach()
  })

  it('flags connectionError (not loadError) and attaches no persistence when a remote load is unavailable', async () => {
    useStore.getState().setLoadError(false)
    useStore.getState().setConnectionError(false)
    const saveAll = vi.fn().mockResolvedValue(undefined)
    // A server-backed adapter whose load fails (server down / network error).
    const adapter: PersistenceAdapter = {
      loadAll: () => Promise.reject(new LoadError('unavailable', 'server down')),
      saveAll,
    }

    const detach = await bootstrap(useStore, adapter, { debounceMs: 0, seedIfEmpty: seed() })

    // Routed to the retry screen, NOT the corrupt-data reset UI.
    expect(useStore.getState().connectionError).toBe(true)
    expect(useStore.getState().loadError).toBe(false)
    expect(useStore.getState().hydrated).toBe(true)
    expect(useStore.getState().data.resources).toHaveLength(0) // rendered empty, not seeded

    // No autosave attached: an edit must not be pushed as a destructive diff to a
    // server that merely returned once.
    useStore.getState().addAccount({ name: 'New', color: '#111111' })
    await new Promise((r) => setTimeout(r, 5))
    expect(saveAll).not.toHaveBeenCalled()

    useStore.getState().setConnectionError(false)
    detach()
  })
})
