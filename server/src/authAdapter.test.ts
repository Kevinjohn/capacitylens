import { describe, it, expect } from 'vitest'
import { betterAuthAdapter } from './authAdapter'
import type { Auth, SessionUser } from './auth'

// P0.5.8: the AuthAdapter contract — the null-vs-throw split is load-bearing (app.ts maps
// null → 401, a throw → 503). These cases pin betterAuthAdapter's mapping of a fake Better
// Auth getSession onto that contract; no real Better Auth / DB is needed.

const USER: SessionUser = { id: 'u1', name: 'Tester', email: 'tester@capacitylens.dev' }

/** A minimal fake Auth whose getSession yields whatever this factory is given. */
function fakeAuth(getSession: Auth['api']['getSession']): Auth {
  return {
    handler: async () => new Response(null),
    api: { getSession },
    options: {},
  }
}

describe('betterAuthAdapter.verifySession', () => {
  it('returns the user for a valid session', async () => {
    const adapter = betterAuthAdapter(fakeAuth(async () => ({ user: USER })))
    await expect(adapter.verifySession(new Headers())).resolves.toEqual(USER)
  })

  it('returns null when there is no session', async () => {
    const adapter = betterAuthAdapter(fakeAuth(async () => null))
    await expect(adapter.verifySession(new Headers())).resolves.toBeNull()
  })

  it('PROPAGATES a backend failure (does not swallow it to null → keeps the 503 signal)', async () => {
    const boom = new Error('auth backend down')
    const adapter = betterAuthAdapter(
      fakeAuth(async () => {
        throw boom
      }),
    )
    await expect(adapter.verifySession(new Headers())).rejects.toBe(boom)
  })
})
