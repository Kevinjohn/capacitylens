import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useLifecycleActions } from './useLifecycleActions'
import { useStore } from '../store/useStore'
import { makeAppData, resetStoreWithAccount, DEFAULT_ACCOUNT_ID } from '../test/fixtures'
import type { AppData } from '@capacitylens/shared/types/entities'

// SERVER-mode coverage for the lifecycle dispatch hook (the LOCAL/store path is covered by
// useStore.lifecycle.test.ts + the list/section component tests). With a backend configured, the
// hook POSTs the dedicated P2.5a route, surfaces a non-OK body.error as an error notice WITHOUT
// crashing (the highest-value gap, since purge is destructive), and on success RELOADS the active
// slice via persistenceAdapter.loadAll → replaceAll. We assert OBSERVABLE outcomes: the exact fetch
// args, the store data replaced from the stubbed loadAll, and the surfaced notice on 409/403.

// apiConfig mocked with a fixed API_BASE and isServerConfigured() => true so `run` takes the server
// branch. The vi.hoisted box hoists above the mock factory (a bare `let` would throw "Cannot access
// before initialization") — mirrors ArchivedSection.test.tsx's pattern.
const cfg = vi.hoisted(() => ({ base: 'http://api.test' }))
const refreshControl = vi.hoisted(() => ({
  outcome: 'unattached' as 'reloaded' | 'skipped' | 'failed' | 'unattached',
}))
vi.mock('../data/apiConfig', () => ({
  API_BASE: cfg.base,
  isServerConfigured: () => true,
}))
vi.mock('../data/persist', () => ({
  refreshActiveAccountSlice: async () => refreshControl.outcome,
}))

// The reloaded slice the stubbed loadAll returns — a recognisable AppData so we can prove replaceAll
// ran with EXACTLY this on the success path. Mocking the adapter means no real network/server.
const reloadedSlice: AppData = makeAppData({
  clients: [{ id: 'c-reloaded', accountId: DEFAULT_ACCOUNT_ID, name: 'Reloaded', color: '#111', createdAt: 't', updatedAt: 't' }],
})
// The loadAll spy records the accountId it's called with (asserted via toHaveBeenCalledWith) and
// resolves to the recognisable reloaded slice — the active-slice re-fetch the success path performs.
// Typed via vi.fn<…>() so the mocked adapter's loadAll(id) call type-checks AND the mock API
// (mockResolvedValue / toHaveBeenCalledWith) stays available.
const loadAll = vi.fn<(accountId: string) => Promise<AppData>>(() => Promise.resolve(reloadedSlice))
vi.mock('../data/storageAdapter', () => ({
  persistenceAdapter: { loadAll: (id: string) => loadAll(id) },
}))

beforeEach(() => {
  resetStoreWithAccount() // seeds + activates DEFAULT_ACCOUNT_ID (the hook reads activeAccountId from it)
  loadAll.mockClear()
  loadAll.mockResolvedValue(reloadedSlice)
  refreshControl.outcome = 'unattached'
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Stub fetch with a single canned Response; returns the spy so callers assert the call args. */
function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => response as unknown as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('useLifecycleActions — SERVER mode dispatch', () => {
  it('ignores an overlapping lifecycle mutation until the first transition settles', async () => {
    let release: (() => void) | null = null
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      release = () => resolve({ ok: true, status: 200, json: async () => ({}) } as unknown as Response)
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useLifecycleActions())

    const first = result.current.archive('clients', 'c-1')
    const overlapping = result.current.purge('clients', 'c-1')
    expect(fetchMock).toHaveBeenCalledOnce()
    await expect(overlapping).resolves.toBeUndefined()
    release!()
    await first

    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    ['archive', 'archive'],
    ['unarchive', 'unarchive'],
    ['softDelete', 'delete'], // softDelete maps onto the /delete route verb
    ['purge', 'purge'],
  ] as const)(
    '%s POSTs /api/:entity/:id/%s with {accountId} + credentials, then reloads the active slice on success',
    async (method, verb) => {
      const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({}) })
      const { result } = renderHook(() => useLifecycleActions())

      await result.current[method]('clients', 'c-1')

      // The exact route + body + credentials the P2.5a routes expect.
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`http://api.test/api/clients/c-1/${verb}`)
      expect(init.method).toBe('POST')
      expect(init.credentials).toBe('include')
      expect(JSON.parse(init.body as string)).toEqual({ accountId: DEFAULT_ACCOUNT_ID })

      // Success → the active slice is reloaded via loadAll and pushed into the store via replaceAll.
      expect(loadAll).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID)
      expect(useStore.getState().data.clients.some((c) => c.id === 'c-reloaded')).toBe(true)
      // No error notice on the happy path.
      expect(useStore.getState().notice).toBeNull()
    },
  )

  it('a 409 (purge <30d) surfaces body.error via an error notice and does NOT throw or reload', async () => {
    const fetchMock = stubFetch({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Can only be permanently deleted 30 days after deletion.' }),
    })
    const { result } = renderHook(() => useLifecycleActions())

    // The promise RESOLVES (never rejects) — a caller can `void` it safely.
    await expect(result.current.purge('clients', 'c-young')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useStore.getState().notice?.tone).toBe('error')
    expect(useStore.getState().notice?.message).toBe('Can only be permanently deleted 30 days after deletion.')
    // A failed mutation must NOT reload (no out-of-band write happened).
    expect(loadAll).not.toHaveBeenCalled()
    // The store data was left untouched (still the seeded single-account slice, no 'c-reloaded').
    expect(useStore.getState().data.clients.some((c) => c.id === 'c-reloaded')).toBe(false)
  })

  it('a 403 (non-admin purge) surfaces body.error via an error notice and resolves', async () => {
    stubFetch({ ok: false, status: 403, json: async () => ({ error: 'You do not have permission to do that.' }) })
    const { result } = renderHook(() => useLifecycleActions())

    await expect(result.current.purge('resources', 'r-1')).resolves.toBeUndefined()

    expect(useStore.getState().notice?.tone).toBe('error')
    expect(useStore.getState().notice?.message).toBe('You do not have permission to do that.')
    expect(loadAll).not.toHaveBeenCalled()
  })

  it('a 204 purge (no body) is treated as success: reloads without a body-parse error', async () => {
    // A 204 No Content carries no JSON; res.ok is false at 204 in some runtimes, so the hook guards
    // status === 204 explicitly. Prove that path reloads and surfaces no error notice.
    const fetchMock = stubFetch({
      ok: false,
      status: 204,
      json: async () => {
        throw new Error('no content to parse') // a 204 has no body — must never be parsed on this path
      },
    })
    const { result } = renderHook(() => useLifecycleActions())

    await result.current.purge('clients', 'c-old')

    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/clients/c-old/purge')
    expect(loadAll).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID)
    expect(useStore.getState().data.clients.some((c) => c.id === 'c-reloaded')).toBe(true)
    expect(useStore.getState().notice).toBeNull() // no body-parse error surfaced
  })

  it('SKIPS the post-mutation reload when the active account changed while the POST was in flight', async () => {
    // The wrong-tenant race (P1): the lifecycle POST resolves AFTER the user switched away from the
    // account the mutation ran in. The mutation committed server-side (it shows on that account's
    // next hydration); the NEW tenant's slice is owned by the switch orchestrator, and this stale
    // reload must not fight it — reloading here would install the OLD tenant's slice under the new
    // active id. Simulated by switching the active account inside the stubbed fetch (mid-flight).
    const fetchMock = vi.fn(async () => {
      useStore.getState().setActiveAccount(null) // the user dropped to the picker mid-POST
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useLifecycleActions())

    await result.current.archive('clients', 'c-1')

    expect(fetchMock).toHaveBeenCalledTimes(1) // the mutation itself was dispatched
    expect(loadAll).not.toHaveBeenCalled() // but the stale reload was skipped
    // The store was left for the switch orchestrator — no stale slice installed.
    expect(useStore.getState().data.clients.some((c) => c.id === 'c-reloaded')).toBe(false)
    expect(useStore.getState().notice).toBeNull() // and no spurious error surfaced
  })

  it.each(['skipped', 'failed'] as const)(
    'does not report transport-failure reconciliation as successful when refresh returns %s',
    async (outcome) => {
      refreshControl.outcome = outcome
      const onReloaded = vi.fn()
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new TypeError('connection lost')
      }))
      const { result } = renderHook(() => useLifecycleActions(onReloaded))

      await result.current.archive('clients', 'c-1')

      expect(onReloaded).not.toHaveBeenCalled()
      expect(loadAll).not.toHaveBeenCalled()
      expect(useStore.getState().notice?.tone).toBe('error')
      expect(useStore.getState().notice?.message).toContain('could not be reconciled')
      expect(useStore.getState().notice?.message).toContain(`(${outcome})`)
    },
  )
})
