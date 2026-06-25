import { describe, it, expect } from 'vitest'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp } from './app'
import { openDb } from './db'
import { authFromEnv, parseAuthMode, runAuthMigrations, AuthConfigError, DEMO_USER } from './auth'

// P3.1/P3.2/P3.5 (flag CAPACITYLENS_AUTH → opts.authMode/auth). The load-bearing assertion set:
// OFF is byte-for-byte today (the whole existing app.test.ts suite already enforces that
// by running unchanged — these tests add the /api/auth/me surface and the absence of the
// Better Auth routes); password gates every data route on a real session; sso issues a
// provider redirect; any misconfiguration refuses to boot via AuthConfigError.

const TS = '2026-01-01T00:00:00.000Z'
const account = { id: 'a1', name: 'Studio', color: '#3b82f6', createdAt: TS, updatedAt: TS }

const call = (app: FastifyInstance, opts: InjectOptions): Promise<LightMyRequestResponse> =>
  app.inject(opts) as unknown as Promise<LightMyRequestResponse>

/** Collapse a response's Set-Cookie header(s) into one request Cookie header. */
function cookiesOf(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie']
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  return list.map((c) => String(c).split(';')[0]).join('; ')
}

const PASSWORD_ENV = {
  CAPACITYLENS_AUTH: 'password',
  BETTER_AUTH_SECRET: 'unit-test-secret-0123456789abcdef-0123',
  BETTER_AUTH_URL: 'http://localhost:8787',
}

const SSO_ENV = {
  ...PASSWORD_ENV,
  CAPACITYLENS_AUTH: 'sso',
  CAPACITYLENS_SSO_CLIENT_ID: 'client-id',
  CAPACITYLENS_SSO_CLIENT_SECRET: 'client-secret',
  CAPACITYLENS_SSO_AUTHORIZATION_URL: 'http://idp.test/authorize',
  CAPACITYLENS_SSO_TOKEN_URL: 'http://idp.test/token',
}

async function appWithAuth(env: Record<string, string>): Promise<FastifyInstance> {
  const db = openDb(':memory:')
  const { mode, auth } = authFromEnv(db, env)
  await runAuthMigrations(auth!)
  return buildApp(db, { authMode: mode, auth })
}

describe('CAPACITYLENS_AUTH off (default)', () => {
  it('reports the demo identity from /api/auth/me and gates nothing', async () => {
    const app = buildApp(openDb(':memory:'))
    const me = await call(app, { method: 'GET', url: '/api/auth/me' })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toEqual({ authMode: 'off', user: DEMO_USER })
    // A cookie-less write succeeds — no request that succeeds today may fail in off mode.
    const write = await call(app, { method: 'POST', url: '/api/accounts', payload: account })
    expect(write.statusCode).toBe(201)
  })

  it('mounts NO Better Auth routes (zero new attack surface)', async () => {
    const app = buildApp(openDb(':memory:'))
    const res = await call(app, { method: 'GET', url: '/api/auth/get-session' })
    expect(res.statusCode).toBe(404)
    const signUp = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'a@b.test', password: 'password-123', name: 'X' },
    })
    expect(signUp.statusCode).toBe(404)
  })
})

describe('CAPACITYLENS_AUTH password', () => {
  it('401s data routes without a session; /api/health stays open', async () => {
    const app = await appWithAuth(PASSWORD_ENV)
    expect((await call(app, { method: 'GET', url: '/api/state' })).statusCode).toBe(401)
    expect((await call(app, { method: 'POST', url: '/api/accounts', payload: account })).statusCode).toBe(401)
    expect((await call(app, { method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    const me = await call(app, { method: 'GET', url: '/api/auth/me' })
    expect(me.statusCode).toBe(401)
    expect(me.json().authMode).toBe('password') // the login screen needs the mode
  })

  it('sign-up → session cookie → writes succeed and /api/auth/me reports the user', async () => {
    const app = await appWithAuth(PASSWORD_ENV)
    const signUp = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'tester@capacitylens.dev', password: 'password-123', name: 'Tester' },
    })
    expect(signUp.statusCode).toBe(200)
    const cookie = cookiesOf(signUp)
    expect(cookie).toContain('better-auth.session_token')

    const me = await call(app, { method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(me.statusCode).toBe(200)
    expect(me.json().authMode).toBe('password')
    expect(me.json().user.email).toBe('tester@capacitylens.dev')

    const write = await call(app, { method: 'POST', url: '/api/accounts', payload: account, headers: { cookie } })
    expect(write.statusCode).toBe(201)
    expect((await call(app, { method: 'GET', url: '/api/state', headers: { cookie } })).json().accounts).toHaveLength(1)
  })

  it('sign-out invalidates the session again', async () => {
    const app = await appWithAuth(PASSWORD_ENV)
    const signUp = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'out@capacitylens.dev', password: 'password-123', name: 'Out' },
    })
    const cookie = cookiesOf(signUp)
    const out = await call(app, { method: 'POST', url: '/api/auth/sign-out', payload: {}, headers: { cookie } })
    expect(out.statusCode).toBe(200)
    expect((await call(app, { method: 'GET', url: '/api/state', headers: { cookie } })).statusCode).toBe(401)
  })
})

describe('CAPACITYLENS_AUTH sso', () => {
  it('issues a redirect to the configured provider', async () => {
    const app = await appWithAuth(SSO_ENV)
    const res = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-in/oauth2',
      payload: { providerId: 'sso', callbackURL: '/' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { url: string; redirect: boolean }
    expect(body.redirect).toBe(true)
    expect(body.url.startsWith('http://idp.test/authorize')).toBe(true)
  })
})

describe('boot refusal (AuthConfigError)', () => {
  it('rejects an unknown CAPACITYLENS_AUTH value; blank/unset means off', () => {
    expect(() => parseAuthMode('on')).toThrow(AuthConfigError)
    expect(parseAuthMode(undefined)).toBe('off')
    expect(parseAuthMode('')).toBe('off')
  })

  it("off mode reads no BETTER_AUTH_* env at all", () => {
    const { mode, auth } = authFromEnv(openDb(':memory:'), { CAPACITYLENS_AUTH: 'off' })
    expect(mode).toBe('off')
    expect(auth).toBeNull()
  })

  it('password mode without secret or URL refuses', () => {
    const db = openDb(':memory:')
    expect(() => authFromEnv(db, { CAPACITYLENS_AUTH: 'password' })).toThrow(AuthConfigError)
    expect(() => authFromEnv(db, { CAPACITYLENS_AUTH: 'password', BETTER_AUTH_SECRET: 'x'.repeat(32) })).toThrow(
      AuthConfigError,
    )
  })

  it('sso mode without provider endpoints refuses', () => {
    const db = openDb(':memory:')
    expect(() =>
      authFromEnv(db, {
        ...PASSWORD_ENV,
        CAPACITYLENS_AUTH: 'sso',
        CAPACITYLENS_SSO_CLIENT_ID: 'id',
        CAPACITYLENS_SSO_CLIENT_SECRET: 'secret',
        // no discovery URL and no authorization+token pair
      }),
    ).toThrow(AuthConfigError)
  })

  it('buildApp refuses authMode ≠ off without an auth instance', () => {
    expect(() => buildApp(openDb(':memory:'), { authMode: 'password' })).toThrow(/requires a Better Auth instance/)
  })
})
