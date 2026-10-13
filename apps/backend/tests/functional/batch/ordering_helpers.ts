import type { ApiClient } from '@japa/api-client'
import { seed } from '@capacitylens/shared/data/seed'
import type { AppData } from '@capacitylens/shared/types/entities'

export interface SyncOrder {
  sessionId: string
  sequence: number
}

export async function resetSeed(client: ApiClient) {
  const response = await client.post('/api/test/reset').json({ seed: true }).send()
  response.assertStatus(200)
}

export async function readStudioState(client: ApiClient) {
  const response = await client.get('/api/state?accountId=a-studio&includeInactive=1').send()
  response.assertStatus(200)
  return response.body() as AppData
}

export function trusted<T extends { header(name: string, value: string): T }>(request: T) {
  return request.header('sec-fetch-site', 'same-origin')
}

export function batch(client: ApiClient, ops: unknown[], order?: SyncOrder) {
  const request = trusted(client.post('/api/batch'))
  if (order) {
    request
      .header('x-capacitylens-sync-session', order.sessionId)
      .header('x-capacitylens-sync-sequence', String(order.sequence))
  }
  return request.json({ ops } as never).send()
}

export function studioSeed() {
  const data = seed()
  const account = data.accounts.find((row) => row.id === 'a-studio')
  if (!account) throw new Error('The studio seed account is missing.')
  return { data, account }
}
