import { describe, expect, it, vi } from 'vitest'

const mocks = await vi.hoisted(async () => {
  const { createRequestLog } = await import('@/test/fetchRequests')
  return {
    requests: createRequestLog(),
    fetchApi: vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 204 }))),
    requestSignal: vi.fn((signal?: AbortSignal) => signal),
  }
})

vi.mock('@/data/requestTimeout', () => ({
  fetchApi: (input: RequestInfo | URL, init?: RequestInit) => {
    mocks.requests.record(input, init)
    return mocks.fetchApi(input, init)
  },
  API_BULK_TIMEOUT_MS: 120_000,
  createRequestSignal: mocks.requestSignal,
}))

import { admissionRequests } from './admissionRequests'

describe('admission list query', () => {
  it('encodes an opaque cursor once and preserves credentials and cancellation', async () => {
    const controller = new AbortController()
    await admissionRequests.listAdmissionRequests('pending', 'next+/=&?', controller.signal)
    const requests = await mocks.requests.read()
    const sent = requests.at(-1)
    if (!sent) throw new Error('Expected admission read')
    const url = sent.url
    expect(url.pathname).toBe('/api/v1/admission/requests')
    expect(url.searchParams.get('status')).toBe('pending')
    expect(url.searchParams.get('cursor')).toBe('next+/=&?')
    expect(sent.credentials).toBe('include')
    expect(sent.signal.aborted).toBe(false)
    controller.abort()
    expect(sent.signal.aborted).toBe(true)
  })
})
