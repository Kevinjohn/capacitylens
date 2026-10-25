import { randomUUID } from 'node:crypto'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { seed } from '@capacitylens/shared/data/seed'
import { type AppData } from '@capacitylens/shared/types/entities'
import { resetState } from '#services/state_repository'
import { clearIdentities, createIdentity } from '../../helpers/identities.js'

export const accountId = 'a-studio'
export const planningUrl = `/api/accounts/${accountId}/planning`
const password = 'batman-secret-2026'

export const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

export function session<
  T extends {
    header(name: string, value: string): T
    setup(callback: () => void): T
    withCookie(name: string, value: string): T
  },
>(request: T, cookie: string): T {
  return trusted(request).setup(() => {
    request.withCookie('adonis-session', cookie)
  })
}

export function configureAuth(cleanup: (callback: () => void) => void) {
  const prior = env.get('CAPACITYLENS_RATE_LIMIT')
  env.set('CAPACITYLENS_RATE_LIMIT', '0')
  cleanup(() => env.set('CAPACITYLENS_RATE_LIMIT', prior as never))
}

/** A real password sign-in establishes the Account Kit session; membership is fixture data. */
export async function signIn(
  client: ApiClient,
  role: 'owner' | 'admin' | 'editor' | 'viewer' = 'owner'
) {
  const email = `bruce-${randomUUID()}@wayne.example`
  const userId = await createIdentity(email, { name: 'Bruce Wayne', password })
  const cookie = await signInAgain(client, email)
  const now = new Date().toISOString()
  await db.table('memberships').insert({
    id: randomUUID(),
    account_id: accountId,
    user_id: userId,
    role,
    status: 'active',
    created_at: now,
    updated_at: now,
  })
  return { cookie, userId, email }
}

/** A real password sign-in opens another native session for an existing user. */
export async function signInAgain(client: ApiClient, email: string) {
  const signin = await trusted(client.post('/api/auth/sign-in')).json({ email, password }).send()
  signin.assertStatus(200)
  const cookie = signin.cookie('adonis-session')?.value
  if (!cookie) throw new Error('Sign-in did not return a native session')
  return cookie
}

export async function resetPlanningFixture(): Promise<AppData> {
  await clearIdentities()
  await db.from('rate_limits').delete()
  await resetState(false)
  await resetState(true)
  const data = seed()
  return data
}

export function newAllocation(data: AppData) {
  const resource = data.resources.find(
    (row) =>
      row.accountId === accountId && row.kind === 'person' && !row.archivedAt && !row.deletedAt
  )!
  const activity = data.activities.find(
    (row) =>
      row.accountId === accountId && row.kind === 'internal' && !row.archivedAt && !row.deletedAt
  )!
  return {
    id: randomUUID(),
    resourceId: resource.id,
    activityId: activity.id,
    projectId: null,
    startDate: '2026-11-02',
    endDate: '2026-11-06',
    hoursPerDay: 7.5,
    status: 'confirmed' as const,
  }
}
