import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetchReauth } from './apiFetchReauth'
import { reauthPending, resolveReauth } from './reauthCoordinator'

// DEFECT B — the step-up interception seam. apiFetchReauth wraps apiFetch and, on the server's
// SESSION_NOT_FRESH 403, raises the shared re-auth request (the dialog is driven off reauthPending)
// and — after a successful re-auth — transparently RE-ISSUES the identical request. A cancel or a
// non-freshness response passes straight through, untouched.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  // Never leak a pending step-up into the next test (the coordinator is a module singleton).
  if (reauthPending()) resolveReauth(false)
  vi.unstubAllGlobals()
})

describe('apiFetchReauth', () => {
  it('passes an ordinary 200 straight through and never raises a step-up', async () => {
    const fetchMock = vi.fn(async () => json(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await apiFetchReauth('http://api.test/api/accounts/a1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(reauthPending()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a plain 403 WITHOUT the SESSION_NOT_FRESH code is not intercepted', async () => {
    const fetchMock = vi.fn(async () => json(403, { error: 'Forbidden.' }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await apiFetchReauth('http://api.test/api/accounts/a1', { method: 'DELETE' })
    expect(res.status).toBe(403)
    expect(reauthPending()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a SESSION_NOT_FRESH 403 raises the step-up, then RETRIES the identical request after a successful re-auth', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(403, { error: 'Sign in again first.', code: 'SESSION_NOT_FRESH' }))
      .mockResolvedValueOnce(json(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = apiFetchReauth('http://api.test/api/accounts/a1', { method: 'DELETE' })
    // The dialog trigger: a step-up becomes pending, and we have NOT retried yet.
    await vi.waitFor(() => expect(reauthPending()).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveReauth(true) // the dialog reports a fresh session
    const res = await pending
    expect(res.status).toBe(200) // the retried request's response, handed back transparently
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(reauthPending()).toBe(false)
  })

  it('a cancelled step-up returns the ORIGINAL 403 with its body intact and does not retry', async () => {
    const fetchMock = vi.fn(async () => json(403, { error: 'Sign in again first.', code: 'SESSION_NOT_FRESH' }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = apiFetchReauth('http://api.test/api/accounts/a1', { method: 'DELETE' })
    await vi.waitFor(() => expect(reauthPending()).toBe(true))

    resolveReauth(false) // the user cancels the dialog
    const res = await pending
    expect(res.status).toBe(403)
    // The body was only ever peeked at via clone(), so the caller can still read it (readApiError).
    expect(await res.json()).toMatchObject({ code: 'SESSION_NOT_FRESH' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
