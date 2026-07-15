import { describe, expect, it } from 'vitest'
import { readApiError } from './readApiError'

const responseWith = (value: unknown): Response =>
  ({ json: async () => value }) as Response

describe('readApiError', () => {
  it('returns only a non-empty string error from an object body', async () => {
    await expect(readApiError(responseWith({ error: 'Denied.' }))).resolves.toBe('Denied.')
    await expect(readApiError(responseWith({ error: '' }))).resolves.toBeUndefined()
    await expect(readApiError(responseWith({ error: 403 }))).resolves.toBeUndefined()
    await expect(readApiError(responseWith({}))).resolves.toBeUndefined()
  })

  it.each([null, 'Denied.', 42, []])('rejects non-object API bodies: %j', async (body) => {
    await expect(readApiError(responseWith(body))).resolves.toBeUndefined()
  })

  it('falls back cleanly when JSON parsing fails', async () => {
    const response = { json: async () => { throw new Error('invalid JSON') } } as unknown as Response
    await expect(readApiError(response)).resolves.toBeUndefined()
  })
})
