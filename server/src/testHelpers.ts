import { expect } from 'vitest'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'

// Shared scaffolding for the auth-backed server test suites (app.*.test.ts). The inject wrapper,
// Set-Cookie collapse, sign-up-and-resolve-userId flow, and the password-mode env were duplicated
// byte-for-byte across nine suites; centralising them here stops that growth. Suite-specific fixtures
// (entity builders, seedTwo/seedAccount, appWithAuth, env variants) deliberately stay in each suite.

/** Password-auth env for `authFromEnv`. Open signup is CLOSED by default (P1.7 disableSignUp); these
 *  fixtures create users via sign-up/email, so it is re-opened here until the invite flow is the only
 *  path. A suite that asserts the default-closed posture builds its own env WITHOUT this flag. */
export const PASSWORD_ENV = {
  CAPACITYLENS_AUTH: 'password',
  BETTER_AUTH_SECRET: 'unit-test-secret-0123456789abcdef-0123',
  BETTER_AUTH_URL: 'http://localhost:8787',
  CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
}

/** `app.inject` typed as the light response the suites assert against. */
export const call = (app: FastifyInstance, opts: InjectOptions): Promise<LightMyRequestResponse> =>
  app.inject(opts) as unknown as Promise<LightMyRequestResponse>

/** Collapse a response's Set-Cookie header(s) into one request Cookie header. */
export function cookiesOf(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie']
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  return list.map((c) => String(c).split(';')[0]).join('; ')
}

/** Sign up a user, returning its session cookie + the resolved user id (from /api/auth/me). */
export async function signUp(app: FastifyInstance, email: string): Promise<{ cookie: string; userId: string }> {
  const res = await call(app, {
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'password-123', name: 'Tester' },
  })
  expect(res.statusCode).toBe(200)
  const cookie = cookiesOf(res)
  const me = await call(app, { method: 'GET', url: '/api/auth/me', headers: { cookie } })
  expect(me.statusCode).toBe(200)
  return { cookie, userId: me.json().user.id as string }
}
