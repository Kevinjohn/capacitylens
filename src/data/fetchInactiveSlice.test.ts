import { describe, it, expect, afterEach, vi } from 'vitest'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import {
  fetchInactiveSlice,
  InactiveSliceHttpError,
  InactiveSliceShapeError,
} from './fetchInactiveSlice'

// The shared reader of the purge-gated `?includeInactive=1` admin endpoint. The component suites
// (DeleteCompanyDialog, ArchivedSection) prove each caller's SURFACE; this proves the helper's own
// contract — the request shape, the typed errors and the pre-migrate structural gate — once,
// where both callers inherit it.

afterEach(() => {
  vi.unstubAllGlobals()
})

const ok = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response

describe('fetchInactiveSlice', () => {
  it('requests the includeInactive read for the account, with credentials, and migrates the body', async () => {
    const body = { ...emptyAppData(), accounts: [{ id: 'a 1', name: 'Acme' }] }
    const fetchMock = vi.fn(async () => ok(body))
    vi.stubGlobal('fetch', fetchMock)

    const data = await fetchInactiveSlice('a 1')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain(`/api/state?accountId=${encodeURIComponent('a 1')}&includeInactive=1`)
    expect(init.credentials).toBe('include')
    // migrate() ran: the raw table map came back normalized as a full AppData.
    expect(data.accounts.map((a) => a.id)).toEqual(['a 1'])
  })

  it('throws InactiveSliceHttpError carrying the status and the server `{ error }` sentence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: 'Down for backup.' }) })),
    )
    const err = await fetchInactiveSlice('a1').then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(InactiveSliceHttpError)
    expect((err as InactiveSliceHttpError).status).toBe(503)
    expect((err as InactiveSliceHttpError).serverMessage).toBe('Down for backup.')
  })

  it('throws InactiveSliceHttpError with serverMessage undefined when the error body is unreadable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })),
    )
    const err = await fetchInactiveSlice('a1').then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(InactiveSliceHttpError)
    expect((err as InactiveSliceHttpError).status).toBe(403) // callers branch on this (403 self-hide)
    expect((err as InactiveSliceHttpError).serverMessage).toBeUndefined()
  })

  // The load-bearing gate: a 200 body missing any known table must be REFUSED before migrate()
  // (which would coerce absent tables to [] and synthesize the Internal client — a nearly-empty
  // AppData that reads as "nothing archived" / a complete backup). Partial = accounts row only.
  it('throws InactiveSliceShapeError on a structurally incomplete 200 body', async () => {
    for (const body of [null, [], { definitely: 'not CapacityLens' }, { accounts: [{ id: 'a1' }] }]) {
      vi.stubGlobal('fetch', vi.fn(async () => ok(body)))
      await expect(fetchInactiveSlice('a1')).rejects.toBeInstanceOf(InactiveSliceShapeError)
    }
  })
})
