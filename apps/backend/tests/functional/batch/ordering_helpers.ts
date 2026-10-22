import type { ApiClient } from '@japa/api-client'
import { seed } from '@capacitylens/shared/data/seed'
import type { AppData } from '@capacitylens/shared/types/entities'
import {
  asDataOwner,
  authenticatedDataClient,
  resetAuthenticatedData,
} from '../../helpers/authenticated_data_fixture.js'

export interface SyncOrder {
  sessionId: string
  sequence: number
}

export async function resetSeed(client: ApiClient) {
  return resetAuthenticatedData(client, true)
}

export async function resetSeedClient(client: ApiClient) {
  const session = await resetSeed(client)
  return authenticatedDataClient(client, session.cookie)
}

export async function readStudioState(client: ApiClient, cookie?: string) {
  const request = client.get('/api/state?accountId=a-studio&includeInactive=1')
  const response = await (cookie ? asDataOwner(request, cookie) : request).send()
  response.assertStatus(200)
  return response.body() as AppData
}

export function trusted<T extends { header(name: string, value: string): T }>(request: T) {
  return request.header('sec-fetch-site', 'same-origin')
}

export function batch(
  client: ApiClient,
  ops: unknown[],
  cookieOrOrder?: string | SyncOrder,
  explicitOrder?: SyncOrder
) {
  const cookie = typeof cookieOrOrder === 'string' ? cookieOrOrder : undefined
  const order = typeof cookieOrOrder === 'string' ? explicitOrder : cookieOrOrder
  const rawRequest = client.post('/api/batch')
  const request = cookie ? asDataOwner(rawRequest, cookie) : rawRequest
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
