import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchApi: vi
    .fn<(url: string, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue(new Response(null, { status: 204 })),
  requestSignal: vi.fn((signal?: AbortSignal) => signal),
}))

vi.mock('@/data/requestTimeout', () => ({
  fetchApi: mocks.fetchApi,
  API_BULK_TIMEOUT_MS: 120_000,
  createRequestSignal: mocks.requestSignal,
}))

import { readUnknownAccountOperationOutcome } from './operationOutcome'

describe('browser account api', () => {
  beforeEach(() => {
    mocks.fetchApi
      .mockReset()
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })))
    mocks.requestSignal.mockClear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  it('classifies server and in-progress responses as unknown without consuming the body', async () => {
    const inProgress = Response.json(
      { code: 'COMMAND_IN_PROGRESS', error: 'Still running.' },
      { status: 409 }
    )
    await expect(readUnknownAccountOperationOutcome(inProgress)).resolves.toBe(true)
    await expect(inProgress.json()).resolves.toMatchObject({
      error: 'Still running.',
    })
    await expect(
      readUnknownAccountOperationOutcome(new Response(null, { status: 408 }))
    ).resolves.toBe(true)
    await expect(
      readUnknownAccountOperationOutcome(new Response(null, { status: 503 }))
    ).resolves.toBe(true)
    await expect(
      readUnknownAccountOperationOutcome(
        Response.json({ code: 'DEPENDENCY_UNAVAILABLE' }, { status: 503 })
      )
    ).resolves.toBe(true)
    await expect(
      readUnknownAccountOperationOutcome(
        Response.json({ code: 'MAIL_UNAVAILABLE' }, { status: 503 })
      )
    ).resolves.toBe(false)
    await expect(
      readUnknownAccountOperationOutcome(
        Response.json({ code: 'IDEMPOTENCY_CONFLICT' }, { status: 409 })
      )
    ).resolves.toBe(false)
  })
  it.each(['INVITATION_USED', 'CONFLICT', 'AUTHORIZATION_CHANGED', 'IDEMPOTENCY_CONFLICT'])(
    'classifies the known terminal 409 code %s as final',
    async (code) => {
      await expect(
        readUnknownAccountOperationOutcome(Response.json({ code }, { status: 409 }))
      ).resolves.toBe(false)
    }
  )

  it('classifies unreadable and unrecognised 409 responses as unknown', async () => {
    const unreadable = {
      status: 409,
      clone: () => ({
        json: () => Promise.reject(new Error('response body disconnected')),
      }),
    } as unknown as Response

    await expect(
      readUnknownAccountOperationOutcome(new Response('truncated', { status: 409 }))
    ).resolves.toBe(true)
    await expect(readUnknownAccountOperationOutcome(unreadable)).resolves.toBe(true)
    await expect(
      readUnknownAccountOperationOutcome(
        Response.json({ code: 'FUTURE_CONFLICT_CODE' }, { status: 409 })
      )
    ).resolves.toBe(true)
  })
})
