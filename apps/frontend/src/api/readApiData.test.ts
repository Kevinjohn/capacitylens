import { expect, it } from 'vitest'
import { readApiData } from './readApiData'

it('returns the data inside the envelope', async () => {
  await expect(readApiData(Response.json({ data: { ok: true } }))).resolves.toEqual({ ok: true })
})

it('throws when the envelope is missing', async () => {
  await expect(readApiData(Response.json({ ok: true }))).rejects.toThrow(
    'The response has no data envelope.'
  )
})
