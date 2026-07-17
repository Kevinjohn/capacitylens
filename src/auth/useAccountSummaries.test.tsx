import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { fetchAccountSummaries, useAccountSummaries } from './useAccountSummaries'
import { useStore } from '../store/useStore'
import { offlineStateSnapshot, readCachedAccountSummaries, setOfflineReadState } from '../data/offlineCache'

vi.mock('../data/offlineCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/offlineCache')>()
  return { ...actual, readCachedAccountSummaries: vi.fn(actual.readCachedAccountSummaries) }
})

// P1.13 — the AccountPicker's data source. These tests pin the fetch contract's three distinct
// answers, in particular the malformed-200 case (the bug this pins: a 200 whose JSON body is not
// an array used to coerce to `[]` — a fake "no accounts" that blanked the picker — where every
// other failure reported null / keep-what-you-have):
//   - a real array        -> the validated list ([] only for a GENUINE empty array; off-spec rows
//                            are dropped with a console.warn breadcrumb — partial corruption is
//                            handled-but-logged, never silent)
//   - a non-OK response   -> null (keep what you have)
//   - a 200 NON-ARRAY body -> null too, same stance, with a console.warn breadcrumb
//   - a NONEMPTY array where EVERY row is off-spec -> null too (malformed, NOT "no accounts" —
//                            an [] here would blank the picker over a broken response)
// plus the hook-level consequence: a null read leaves store.accountSummaries untouched.

afterEach(() => {
  useStore.setState({ activeAccountId: null })
  setOfflineReadState(false)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('fetchAccountSummaries — response classification', () => {
  it('a genuine empty array -> [] (the real "no accounts" answer)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, [])))
    await expect(fetchAccountSummaries()).resolves.toEqual([])
  })

  it('a valid array -> validated summaries (off-spec rows dropped, not the whole list) + a warn per drop', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const body = [{ id: 'a1', name: 'Studio A', role: 'editor' }, { bogus: true }]
    vi.stubGlobal('fetch', vi.fn(async () => json(200, body)))
    await expect(fetchAccountSummaries()).resolves.toEqual([{ id: 'a1', name: 'Studio A', role: 'editor' }])
    // Partial corruption is handled-but-logged (DEFENSIVE-CODING §5): the dropped row leaves a breadcrumb.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1 malformed'), body)
  })

  it('does not mark a cached active slice online merely because the company directory responds', async () => {
    useStore.setState({ activeAccountId: 'a1' })
    setOfflineReadState(true, Date.parse('2026-07-17T10:00:00.000Z'))
    vi.stubGlobal('fetch', vi.fn(async () => json(200, [{ id: 'a1', name: 'Studio A', role: 'owner' }])))

    await expect(fetchAccountSummaries()).resolves.toHaveLength(1)

    expect(offlineStateSnapshot().readOnly).toBe(true)
  })

  it('does clear an identity/list-only offline marker at the company picker', async () => {
    useStore.setState({ activeAccountId: null })
    setOfflineReadState(true, Date.parse('2026-07-17T10:00:00.000Z'))
    vi.stubGlobal('fetch', vi.fn(async () => json(200, [{ id: 'a1', name: 'Studio A', role: 'owner' }])))

    await expect(fetchAccountSummaries()).resolves.toHaveLength(1)

    expect(offlineStateSnapshot().readOnly).toBe(false)
  })

  it('keeps a valid account selectable but marks an unrecognized role unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = { id: 'a1', name: 'Studio A', role: 'future-role' }
    vi.stubGlobal('fetch', vi.fn(async () => json(200, [row])))

    await expect(fetchAccountSummaries()).resolves.toEqual([
      { id: 'a1', name: 'Studio A', role: 'viewer', roleStatus: 'unavailable' },
    ])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unrecognized role'), row)
  })

  it('a NONEMPTY array whose rows are ALL malformed -> null (keep what you have, NOT a fake "no accounts") + a warn', async () => {
    // The regression this pins: [null] used to map/filter to [], which the hook treated as a genuine
    // empty list and blanked the picker — contradicting the "[] is reserved for a genuine empty
    // array" contract. All-rows-invalid is a MALFORMED response, so it reports null like the
    // non-array case (the hook then leaves the existing list untouched).
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => json(200, [null])))
    await expect(fetchAccountSummaries()).resolves.toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1 malformed'), [null])
  })

  it('an id-only row is malformed too: [{"id":"a"}] -> null, not []', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}) // silence the expected breadcrumb
    vi.stubGlobal('fetch', vi.fn(async () => json(200, [{ id: 'a' }])))
    await expect(fetchAccountSummaries()).resolves.toBeNull()
  })

  it('a 200 whose body is NOT an array -> null (malformed, not "no accounts") + a warn breadcrumb', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { error: 'proxy said what' })))
    await expect(fetchAccountSummaries()).resolves.toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('non-array'), { error: 'proxy said what' })
  })

  it('a non-OK response -> null (unchanged keep-what-you-have stance)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(503, { error: 'down' })))
    await expect(fetchAccountSummaries()).resolves.toBeNull()
  })

  it('a 5xx plus an unreadable offline directory still resolves null instead of rejecting', async () => {
    const cacheError = new Error('IndexedDB unavailable')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(readCachedAccountSummaries).mockRejectedValueOnce(cacheError)
    vi.stubGlobal('fetch', vi.fn(async () => json(503, { error: 'down' })))

    await expect(fetchAccountSummaries()).resolves.toBeNull()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('offline account list could not be read'), cacheError)
  })
})

/** Mounts the hook bare — it renders nothing; the observable effect is on the store. */
function HookHost() {
  useAccountSummaries()
  return null
}

describe('useAccountSummaries — a malformed 200 leaves the existing list alone', () => {
  it('store.accountSummaries is preserved when /api/accounts 200s with a non-array body', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}) // silence the expected breadcrumb
    const existing = [{ id: 'a1', name: 'Studio A', role: 'owner' as const }]
    useStore.getState().setAccountSummaries(existing)
    let resolveFetch!: () => void
    const done = new Promise<void>((r) => (resolveFetch = r))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        // Signal AFTER returning would race the .json() await inside the hook; queueMicrotask keeps
        // the resolution ordered behind the hook's own awaits closely enough for the flush below.
        queueMicrotask(resolveFetch)
        return json(200, { not: 'an array' })
      }),
    )
    render(<HookHost />)
    await act(async () => {
      await done
      // One extra macrotask so the hook's `await fetchAccountSummaries()` continuation (json parse +
      // the null early-return) has run before we assert.
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(useStore.getState().accountSummaries).toEqual(existing) // untouched — not blanked to []
  })

  it('store.accountSummaries is preserved when /api/accounts 200s with an all-malformed array ([null])', async () => {
    // Same stance as the non-array case above, via the all-rows-dropped -> null path: an array of
    // junk must not read as "no accounts" and blank the picker.
    vi.spyOn(console, 'warn').mockImplementation(() => {}) // silence the expected breadcrumb
    const existing = [{ id: 'a1', name: 'Studio A', role: 'owner' as const }]
    useStore.getState().setAccountSummaries(existing)
    let resolveFetch!: () => void
    const done = new Promise<void>((r) => (resolveFetch = r))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        queueMicrotask(resolveFetch) // same ordering trick as the non-array case above
        return json(200, [null])
      }),
    )
    render(<HookHost />)
    await act(async () => {
      await done
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(useStore.getState().accountSummaries).toEqual(existing) // untouched — not blanked to []
  })

  it('refetches account roles when membership projections are invalidated', async () => {
    let role = 'owner'
    const fetchMock = vi.fn(async () => json(200, [{ id: 'a1', name: 'Studio A', role }]))
    vi.stubGlobal('fetch', fetchMock)
    useStore.setState({ membershipRevision: 0 })
    render(<HookHost />)

    await act(async () => {
      await vi.waitFor(() => expect(useStore.getState().accountSummaries[0]?.role).toBe('owner'))
    })
    role = 'admin'
    act(() => useStore.getState().invalidateMemberships())

    await act(async () => {
      await vi.waitFor(() => expect(useStore.getState().accountSummaries[0]?.role).toBe('admin'))
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
