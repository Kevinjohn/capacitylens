import { describe, it, expect } from 'vitest'
import { betterAuthAdapter } from './authAdapter'
import type { Auth, SessionUser } from './auth'

// P0.5.8: the AuthAdapter contract — the null-vs-throw split is load-bearing (app.ts maps
// null → 401, a throw → 503). These cases pin betterAuthAdapter's mapping of a fake Better
// Auth getSession onto that contract; no real Better Auth / DB is needed.

const USER: SessionUser = { id: 'u1', name: 'Tester', email: 'tester@capacitylens.dev', emailVerified: true }

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

  it('carries emailVerified through unchanged (true and false)', async () => {
    // P1.7a: auth.api.getSession already yields the normalized SessionUser, so the adapter is a
    // pass-through — verify both verified states flow to the caller intact.
    const verified = betterAuthAdapter(fakeAuth(async () => ({ user: { ...USER, emailVerified: true } })))
    await expect(verified.verifySession(new Headers())).resolves.toMatchObject({ emailVerified: true })
    const unverified = betterAuthAdapter(fakeAuth(async () => ({ user: { ...USER, emailVerified: false } })))
    await expect(unverified.verifySession(new Headers())).resolves.toMatchObject({ emailVerified: false })
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
