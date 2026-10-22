import type { ApiClient, ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { resetState } from '#services/state_repository'

const ownerEmail = 'bruce.wayne@wayne.example'
const ownerPassword = 'fixture-password-2026'
const setupToken = 'capacitylens-japa-setup-token-0123456789abcdef'

/** Resets Japa's disposable database and signs in an owner with actual company memberships. */
export async function resetAuthenticatedData(client: ApiClient, seed: boolean | 'single' = true) {
  await resetState(seed)
  const existing = await db.from('users').where('email', ownerEmail).select('id').first()
  const response = existing
    ? await client
        .post('/api/auth/sign-in')
        .json({ email: ownerEmail, password: ownerPassword })
        .send()
    : await client
        .post('/api/auth/sign-up')
        .header('x-capacitylens-setup-token', setupToken)
        .json({ email: ownerEmail, password: ownerPassword, name: 'Bruce Wayne' })
        .send()
  response.assertStatus(existing ? 200 : 201)
  const cookie = response.cookie('adonis-session')?.value
  if (!cookie) throw new Error('The authenticated data fixture did not create a session.')
  const setCookies = response.header('set-cookie')
  const cookieHeader = (Array.isArray(setCookies) ? setCookies : [setCookies])
    .find(
      (value): value is string => typeof value === 'string' && value.startsWith('adonis-session=')
    )
    ?.split(';', 1)[0]
  if (!cookieHeader)
    throw new Error('The authenticated data fixture did not return a session header.')
  const userId = String((response.body() as { user: { id: string } }).user.id)
  const accounts = await db.from('accounts').select('id')
  const now = new Date().toISOString()
  for (const account of accounts)
    await db.table('memberships').insert({
      id: randomUUID(),
      account_id: account.id,
      user_id: userId,
      role: 'owner',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
  return { cookie, cookieHeader, userId }
}

/** Applies a real native session and the normal same-origin header to a Japa request. */
export function asDataOwner<T extends ApiRequest>(request: T, cookie: string): T {
  return request
    .setup(() => {
      request.withCookie('adonis-session', cookie)
    })
    .header('sec-fetch-site', 'same-origin') as T
}

/** Preserves an API client's normal request methods while adding a proved native session. */
export function authenticatedDataClient(client: ApiClient, cookie: string): ApiClient {
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
  return new Proxy(client, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof key !== 'string' || !methods.has(key) || typeof value !== 'function')
        return typeof value === 'function' ? value.bind(target) : value
      return (...args: unknown[]) => asDataOwner(value.apply(target, args), cookie)
    },
  })
}

/** Resets disposable company data and returns a client carrying its owner's real session. */
export async function resetAuthenticatedClient(client: ApiClient, seed: boolean | 'single' = true) {
  const session = await resetAuthenticatedData(client, seed)
  return authenticatedDataClient(client, session.cookie)
}

/** Gives a fixture principal explicit standing in a company inserted directly by a test. */
export async function grantDataOwner(userId: string, accountId: string) {
  const existing = await db
    .from('memberships')
    .where({ user_id: userId, account_id: accountId })
    .first()
  if (existing) return
  const now = new Date().toISOString()
  await db.table('memberships').insert({
    id: randomUUID(),
    account_id: accountId,
    user_id: userId,
    role: 'owner',
    status: 'active',
    created_at: now,
    updated_at: now,
  })
}
