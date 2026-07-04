import { describe, it, expect } from 'vitest'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp } from './app'
import { openDb } from './db'
import {
  authFromEnv,
  parseAuthMode,
  runAuthMigrations,
  AuthConfigError,
  DEMO_USER,
  MIN_BETTER_AUTH_SECRET_LENGTH,
  normalizeSessionUser,
} from './auth'

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
  // P1.7: open email self-registration is CLOSED by default (disableSignUp). These existing
  // fixtures create users via sign-up/email, so re-open it here until invites (P1.9/P1.10).
  // The default-closed posture is asserted in its own describe block below with NO flag.
  CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
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
    // multiAccount/canCreateAccount (single-company cap capability flags): a fresh, empty DB and
    // default opts (multiAccount unset) reports the flag off but creation still open (zero accounts).
    expect(me.json()).toEqual({ authMode: 'off', user: DEMO_USER, multiAccount: false, canCreateAccount: true })
    // P1.7a: off is trusted-local, so the demo principal is verified with a clearly-local email.
    expect(me.json().user).toMatchObject({ email: 'demo@capacitylens.local', emailVerified: true })
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

// P1.7a — the narrowing boundary. normalizeSessionUser reads emailVerified from the full Better
// Auth user and defaults it to false, so a provider that omits verification can never present as
// verified. (getSession in authFromEnv wraps this; here we pin the pure mapping directly.)
describe('normalizeSessionUser (P1.7a)', () => {
  const RAW = { id: 'u1', email: 'u1@capacitylens.dev', name: 'U One' }

  it('carries an explicit emailVerified: true', () => {
    expect(normalizeSessionUser({ ...RAW, emailVerified: true }).emailVerified).toBe(true)
  })

  it('carries an explicit emailVerified: false', () => {
    expect(normalizeSessionUser({ ...RAW, emailVerified: false }).emailVerified).toBe(false)
  })

  it('defaults emailVerified to false when the provider omits it (undefined or null)', () => {
    expect(normalizeSessionUser(RAW).emailVerified).toBe(false)
    expect(normalizeSessionUser({ ...RAW, emailVerified: undefined }).emailVerified).toBe(false)
    expect(normalizeSessionUser({ ...RAW, emailVerified: null }).emailVerified).toBe(false)
  })

  it('yields exactly {id,email,emailVerified,name} (drops any extra Better Auth fields)', () => {
    const out = normalizeSessionUser({ ...RAW, emailVerified: true })
    expect(out).toEqual({ id: 'u1', email: 'u1@capacitylens.dev', emailVerified: true, name: 'U One' })
    expect(Object.keys(out).sort()).toEqual(['email', 'emailVerified', 'id', 'name'])
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
    // P1.7a: emailVerified flows through to /api/auth/me. A fresh email+password sign-up has no
    // verification infra, so Better Auth leaves the flag false — confirming the normalized flag
    // is present and defaults correctly (the P1.10 invite-bind gate depends on it).
    expect(me.json().user.emailVerified).toBe(false)

    const write = await call(app, { method: 'POST', url: '/api/accounts', payload: account, headers: { cookie } })
    expect(write.statusCode).toBe(201)
    // P1.13: the no-arg whole read is CLOSED in auth-on (tenant isolation — the P1.4 carry-forward).
    // A logged-in user must hydrate PER ACCOUNT via ?accountId=, so the bare GET /api/state now 400s.
    const noArg = await call(app, { method: 'GET', url: '/api/state', headers: { cookie } })
    expect(noArg.statusCode).toBe(400)
    // The bare account write above does NOT grant membership (account_members is separate), so the
    // membership-existence guard 403s a scoped read of 'a1' for this user — the slice path itself is
    // exercised in app.accounts.test.ts (member → 200). Here we only pin that no-arg is closed.
    const scoped = await call(app, { method: 'GET', url: '/api/state?accountId=a1', headers: { cookie } })
    expect(scoped.statusCode).toBe(403)
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

// P1.7 — native social providers wired from env. Assert against the resolved betterAuth
// options (auth.options is the exact object we passed; see better-auth createBetterAuth),
// which is the robust introspection point in this version (1.6.20).
describe('social providers (P1.7)', () => {
  const SOCIAL_ENV = {
    ...PASSWORD_ENV,
    CAPACITYLENS_GOOGLE_CLIENT_ID: 'google-id',
    CAPACITYLENS_GOOGLE_CLIENT_SECRET: 'google-secret',
    CAPACITYLENS_MICROSOFT_CLIENT_ID: 'ms-id',
    CAPACITYLENS_MICROSOFT_CLIENT_SECRET: 'ms-secret',
    CAPACITYLENS_GITHUB_CLIENT_ID: 'gh-id',
    CAPACITYLENS_GITHUB_CLIENT_SECRET: 'gh-secret',
  }

  it('inits all three (Google/Microsoft/GitHub) from env without throwing', () => {
    const { auth } = authFromEnv(openDb(':memory:'), SOCIAL_ENV)
    const social = auth!.options.socialProviders ?? {}
    expect(Object.keys(social).sort()).toEqual(['github', 'google', 'microsoft'])
    expect(social.google).toMatchObject({ clientId: 'google-id', clientSecret: 'google-secret' })
    expect(social.github).toMatchObject({ clientId: 'gh-id', clientSecret: 'gh-secret' })
    // Microsoft tenantId defaults to 'common' when not pinned.
    expect(social.microsoft).toMatchObject({ clientId: 'ms-id', clientSecret: 'ms-secret', tenantId: 'common' })
  })

  it('honours an explicit Microsoft tenant id', () => {
    const { auth } = authFromEnv(openDb(':memory:'), {
      ...SOCIAL_ENV,
      CAPACITYLENS_MICROSOFT_TENANT_ID: 'tenant-123',
    })
    expect(auth!.options.socialProviders?.microsoft).toMatchObject({ tenantId: 'tenant-123' })
  })

  it('does NOT configure a provider when its env is absent (fail-closed-absent)', () => {
    // Only Google set; Microsoft/GitHub must be absent, and a half-set provider (id only)
    // is NOT configured.
    const { auth } = authFromEnv(openDb(':memory:'), {
      ...PASSWORD_ENV,
      CAPACITYLENS_GOOGLE_CLIENT_ID: 'google-id',
      CAPACITYLENS_GOOGLE_CLIENT_SECRET: 'google-secret',
      CAPACITYLENS_GITHUB_CLIENT_ID: 'gh-id-only', // secret missing on purpose
    })
    const social = auth!.options.socialProviders ?? {}
    expect(Object.keys(social)).toEqual(['google'])
    expect(social.github).toBeUndefined()
    expect(social.microsoft).toBeUndefined()
  })

  it('is empty (no providers) when no social env is set', () => {
    const { auth } = authFromEnv(openDb(':memory:'), PASSWORD_ENV)
    expect(Object.keys(auth!.options.socialProviders ?? {})).toEqual([])
  })
})

// P1.7 — open email self-registration is CLOSED by default (the secure default). The flag
// CAPACITYLENS_ALLOW_OPEN_SIGNUP=1 is an interim escape until invites (P1.9/P1.10).
describe('closed self-registration (P1.7)', () => {
  /** PASSWORD_ENV but with the open-signup escape removed → default-closed posture. */
  const CLOSED_ENV: Record<string, string> = { ...PASSWORD_ENV }
  delete CLOSED_ENV.CAPACITYLENS_ALLOW_OPEN_SIGNUP

  const signUp = (app: FastifyInstance) =>
    call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'late@capacitylens.dev', password: 'password-123', name: 'Late' },
    })

  it('rejects POST /api/auth/sign-up/email by DEFAULT (400, disableSignUp on)', async () => {
    const app = await appWithAuth(CLOSED_ENV)
    const res = await signUp(app)
    // Better Auth returns 400 BAD_REQUEST (EMAIL_PASSWORD_SIGN_UP_DISABLED) when disableSignUp.
    expect(res.statusCode).toBe(400)
    expect(cookiesOf(res)).not.toContain('better-auth.session_token')
  })

  it('allows sign-up only when CAPACITYLENS_ALLOW_OPEN_SIGNUP=1', async () => {
    const app = await appWithAuth({ ...CLOSED_ENV, CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1' })
    const res = await signUp(app)
    expect(res.statusCode).toBe(200)
    expect(cookiesOf(res)).toContain('better-auth.session_token')
  })

  it('sets disableSignUp on the resolved options to mirror the flag', () => {
    const open = authFromEnv(openDb(':memory:'), { ...CLOSED_ENV, CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1' })
    const closed = authFromEnv(openDb(':memory:'), CLOSED_ENV)
    expect(open.auth!.options.emailAndPassword?.disableSignUp).toBe(false)
    expect(closed.auth!.options.emailAndPassword?.disableSignUp).toBe(true)
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

  it('password mode with a too-short secret refuses (length is the cause, not the URL)', () => {
    const db = openDb(':memory:')
    const tooShort = 'x'.repeat(MIN_BETTER_AUTH_SECRET_LENGTH - 1)
    let thrown: unknown
    try {
      authFromEnv(db, { ...PASSWORD_ENV, BETTER_AUTH_SECRET: tooShort })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(AuthConfigError)
    // Message names the requirement + actual length, and never leaks the secret value.
    expect((thrown as Error).message).toContain(String(MIN_BETTER_AUTH_SECRET_LENGTH))
    expect((thrown as Error).message).not.toContain(tooShort)
  })

  it('password mode with an exactly-32-char secret passes the length gate', () => {
    const db = openDb(':memory:')
    // PASSWORD_ENV has a valid URL; a 32-char secret must NOT trip the length check.
    expect(() =>
      authFromEnv(db, { ...PASSWORD_ENV, BETTER_AUTH_SECRET: 'x'.repeat(MIN_BETTER_AUTH_SECRET_LENGTH) }),
    ).not.toThrow()
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
