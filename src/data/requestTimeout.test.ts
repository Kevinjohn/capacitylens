import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_WARNING_EVENT } from '../lib/auditWarning'
import { apiFetch, requestSignal, API_REQUEST_TIMEOUT_MS, API_BULK_TIMEOUT_MS } from './requestTimeout'

afterEach(() => vi.unstubAllGlobals())

describe('requestSignal tiers', () => {
  // AbortSignal.timeout schedules on an internal timer that fake timers don't intercept, so assert
  // the BOUND requested per tier rather than trying to fast-forward the deadline.
  it('uses the interactive 15s bound by default and the 120s bulk bound when asked', () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    requestSignal()
    expect(spy).toHaveBeenLastCalledWith(API_REQUEST_TIMEOUT_MS)
    requestSignal(undefined, API_BULK_TIMEOUT_MS)
    expect(spy).toHaveBeenLastCalledWith(API_BULK_TIMEOUT_MS)
    spy.mockRestore()
  })

  it('the null tier never arms a timeout (the keepalive unload flush)', () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    const signal = requestSignal(undefined, null)
    expect(spy).not.toHaveBeenCalled()
    expect(signal.aborted).toBe(false)
    spy.mockRestore()
  })

  it('honours the caller signal even with no timeout', () => {
    const controller = new AbortController()
    const signal = requestSignal(controller.signal, null)
    expect(signal.aborted).toBe(false)
    controller.abort()
    expect(signal.aborted).toBe(true)
  })
})

describe('apiFetch', () => {
  it('announces audit degradation from direct API response headers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'x-capacitylens-audit-warning': 'true' } }),
    ))
    const listener = vi.fn()
    globalThis.addEventListener(AUDIT_WARNING_EVENT, listener)
    try {
      await apiFetch('/api/direct-action')
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(listener).toHaveBeenCalledOnce()
    } finally {
      globalThis.removeEventListener(AUDIT_WARNING_EVENT, listener)
    }
  })
})
