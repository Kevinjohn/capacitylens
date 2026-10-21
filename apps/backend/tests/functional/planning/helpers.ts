import { randomUUID } from 'node:crypto'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { seed } from '@capacitylens/shared/data/seed'
import { type AppData } from '@capacitylens/shared/types/entities'
import { resetState } from '#services/state_repository'

export const accountId = 'a-studio'
export const planningUrl = `/api/accounts/${accountId}/planning`
const password = 'batman-secret-2026'
const setupToken = 'planning-auth-setup-token-0123456789abcdef'

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
  const keys = [
    'CAPACITYLENS_MODE',
    'CAPACITYLENS_SETUP_TOKEN',
    'CAPACITYLENS_ALLOW_OPEN_SIGNUP',
    'CAPACITYLENS_PASSWORD_BREACH_CHECK',
    'CAPACITYLENS_RATE_LIMIT',
  ] as const
  const prior = keys.map((key) => env.get(key))
  env.set('CAPACITYLENS_MODE', 'password-only')
  env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
  env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', true)
  env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
  env.set('CAPACITYLENS_RATE_LIMIT', '0')
  cleanup(() => {
    keys.forEach((key, index) => env.set(key, prior[index] as never))
  })
}

/** Real sign-up establishes the native session; only product membership is fixture data. */
export async function signIn(
  client: ApiClient,
  role: 'owner' | 'admin' | 'editor' | 'viewer' = 'owner'
) {
  const signup = await trusted(client.post('/api/auth/sign-up'))
    .header('x-capacitylens-setup-token', setupToken)
    .json({ email: `bruce-${randomUUID()}@wayne.example`, password, name: 'Bruce Wayne' })
    .send()
  signup.assertStatus(201)
  const cookie = signup.cookie('adonis-session')?.value
  if (!cookie) throw new Error('Sign-up did not return a native session')
  const userId = String((signup.body() as { user: { id: string } }).user.id)
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
  return { cookie, userId }
}

export async function resetPlanningFixture(): Promise<AppData> {
  await db.from('user_session_index').delete()
  await db.from('adonis_sessions').delete()
  await db.from('memberships').delete()
  await db.from('users').delete()
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
