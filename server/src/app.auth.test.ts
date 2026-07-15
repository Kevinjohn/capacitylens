import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp } from './app'
import { openDb } from './db'
import {
  authFromEnv,
  countUsers,
  createBootstrapAdmin,
  createCredentialUserWith,
  parseAuthMode,
  runAuthMigrations,
  AuthConfigError,
  BOOTSTRAP_ADMIN_EMAIL,
  DEMO_USER,
  MIN_BETTER_AUTH_SECRET_LENGTH,
  normalizeSessionUser,
  SESSION_INACTIVITY_TTL_SECONDS,
} from './auth'
import type { Auth } from './auth'
import { MIN_PASSWORD_LENGTH } from '@capacitylens/shared/domain/password'

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

function totpCode(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char)
    if (index < 0) throw new Error('Invalid base32 TOTP secret.')
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2))
  }
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const number = (digest.readUInt32BE(offset) & 0x7fff_ffff) % 1_000_000
  return number.toString().padStart(6, '0')
}

const PASSWORD_ENV = {
  CAPACITYLENS_AUTH: 'password',
  BETTER_AUTH_SECRET: 'unit-test-secret-0123456789abcdef-0123',
  BETTER_AUTH_URL: 'http://localhost:8787',
  // These broad auth fixtures create multiple users through the public sign-up route, so they use
  // the explicit test/dev escape. The production default-closed posture is asserted separately.
  CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
}

const SSO_ENV = {
  ...PASSWORD_ENV,
  CAPACITYLENS_AUTH: 'sso',
  CAPACITYLENS_SSO_CLIENT_ID: 'client-id',
  CAPACITYLENS_SSO_CLIENT_SECRET: 'client-secret',
  CAPACITYLENS_SSO_AUTHORIZATION_URL: 'https://idp.test/authorize',
  CAPACITYLENS_SSO_TOKEN_URL: 'https://idp.test/token',
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
    expect(me.json()).toEqual({ authMode: 'off', user: DEMO_USER, providers: [], multiAccount: false, canCreateAccount: true })
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
      payload: { email: 'a@b.test', password: 'password-123456', name: 'X' },
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

  it('yields the approved public session fields and drops every other Better Auth field', () => {
    const out = normalizeSessionUser({ ...RAW, emailVerified: true })
    expect(out).toEqual({
      id: 'u1',
      email: 'u1@capacitylens.dev',
      emailVerified: true,
      name: 'U One',
      twoFactorEnabled: false,
    })
    expect(Object.keys(out).sort()).toEqual(['email', 'emailVerified', 'id', 'name', 'twoFactorEnabled'])
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

  it('requires enrollment, verifies TOTP, and challenges every later password sign-in', async () => {
    const db = openDb(':memory:')
    const configured = authFromEnv(db, PASSWORD_ENV)
    await runAuthMigrations(configured.auth!)
    const app = buildApp(db, { authMode: configured.mode, auth: configured.auth, requireMfa: true })
    const email = 'mfa-user@capacitylens.dev'
    const password = 'password-123456'

    const signup = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email, password, name: 'MFA User' },
    })
    expect(signup.statusCode).toBe(200)
    const signupCookie = cookiesOf(signup)
    const blocked = await call(app, { method: 'GET', url: '/api/accounts', headers: { cookie: signupCookie } })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().code).toBe('MFA_ENROLLMENT_REQUIRED')

    const before = await call(app, { method: 'GET', url: '/api/auth/me', headers: { cookie: signupCookie } })
    expect(before.statusCode).toBe(200)
    expect(before.json()).toMatchObject({ mfaRequired: true, user: { twoFactorEnabled: false } })

    const enabled = await call(app, {
      method: 'POST',
      url: '/api/auth/two-factor/enable',
      headers: { cookie: signupCookie },
      payload: { password },
    })
    expect(enabled.statusCode).toBe(200)
    expect(enabled.json().backupCodes).toHaveLength(10)
    const secret = new URL(enabled.json().totpURI as string).searchParams.get('secret')
    expect(secret).toBeTruthy()

    const verified = await call(app, {
      method: 'POST',
      url: '/api/auth/two-factor/verify-totp',
      headers: { cookie: signupCookie },
      payload: { code: totpCode(secret!), trustDevice: false },
    })
    expect(verified.statusCode).toBe(200)
    const enrolledCookie = cookiesOf(verified)
    const after = await call(app, { method: 'GET', url: '/api/auth/me', headers: { cookie: enrolledCookie } })
    expect(after.statusCode).toBe(200)
    expect(after.json()).toMatchObject({ mfaRequired: false, user: { twoFactorEnabled: true } })
    expect((await call(app, { method: 'GET', url: '/api/accounts', headers: { cookie: enrolledCookie } })).statusCode)
      .toBe(200)

    expect((await call(app, {
      method: 'POST', url: '/api/auth/sign-out', headers: { cookie: enrolledCookie },
    })).statusCode).toBe(200)
    const signIn = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email, password },
    })
    expect(signIn.statusCode).toBe(200)
    expect(signIn.json()).toMatchObject({ twoFactorRedirect: true })
    const challengeCookie = cookiesOf(signIn)
    expect((await call(app, { method: 'GET', url: '/api/accounts', headers: { cookie: challengeCookie } })).statusCode)
      .toBe(401)

    const completed = await call(app, {
      method: 'POST',
      url: '/api/auth/two-factor/verify-totp',
      headers: { cookie: challengeCookie },
      payload: { code: totpCode(secret!), trustDevice: false },
    })
    expect(completed.statusCode).toBe(200)
    const finalCookie = cookiesOf(completed)
    expect((await call(app, { method: 'GET', url: '/api/accounts', headers: { cookie: finalCookie } })).statusCode)
      .toBe(200)
  })

  it('sign-up → session cookie → the session authenticates and /api/auth/me reports the user', async () => {
    const app = await appWithAuth(PASSWORD_ENV)
    const signUp = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'tester@capacitylens.dev', password: 'password-123456', name: 'Tester' },
    })
    expect(signUp.statusCode).toBe(200)
    const cookie = cookiesOf(signUp)
    expect(cookie).toContain('capacitylens.session_token')

    const me = await call(app, { method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(me.statusCode).toBe(200)
    expect(me.json().authMode).toBe('password')
    expect(me.json().user.email).toBe('tester@capacitylens.dev')
    expect(me.json().mfaRequired).toBe(false)
    // P1.7a: emailVerified flows through to /api/auth/me. A fresh email+password sign-up has no
    // verification infra, so Better Auth leaves the flag false — confirming the normalized flag
    // is present and defaults correctly (the P1.10 invite-bind gate depends on it).
    expect(me.json().user.emailVerified).toBe(false)

    // The GENERIC account create is CLOSED auth-on (403 → POST /api/orgs): the bare row write never
    // minted a membership, so it could only produce orphan accounts — /api/orgs is the atomic path.
    // A session is still proven to authenticate (403, an authz refusal — not the session-less 401).
    const write = await call(app, { method: 'POST', url: '/api/accounts', payload: account, headers: { cookie } })
    expect(write.statusCode).toBe(403)
    expect(write.json().error).toContain('/api/orgs')
    // P1.13: the no-arg whole read is CLOSED in auth-on (tenant isolation — the P1.4 carry-forward).
    // A logged-in user must hydrate PER ACCOUNT via ?accountId=, so the bare GET /api/state now 400s.
    const noArg = await call(app, { method: 'GET', url: '/api/state', headers: { cookie } })
    expect(noArg.statusCode).toBe(400)
    // No membership exists for this fresh user, so the membership-existence guard 403s a scoped read
    // of 'a1' — the slice path itself is exercised in app.accounts.test.ts (member → 200). Here we
    // only pin that no-arg is closed.
    const scoped = await call(app, { method: 'GET', url: '/api/state?accountId=a1', headers: { cookie } })
    expect(scoped.statusCode).toBe(403)
  })

  it('emits a valid __Host session cookie for an HTTPS public origin', async () => {
    const app = await appWithAuth({ ...PASSWORD_ENV, BETTER_AUTH_URL: 'https://capacity.example' })
    const signUp = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'host-cookie@capacitylens.dev', password: 'password-123456', name: 'Host Cookie' },
    })
    expect(signUp.statusCode).toBe(200)
    const raw = signUp.headers['set-cookie']
    const cookies = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String)
    const session = cookies.find((cookie) => cookie.startsWith('__Host-capacitylens.session_token='))
    expect(session).toBeDefined()
    expect(session).toMatch(/;\s*Path=\//i)
    expect(session).toMatch(/;\s*Secure/i)
    expect(session).toMatch(/;\s*HttpOnly/i)
    expect(session).not.toMatch(/;\s*Domain=/i)
  })

  it('expires an idle session before a direct authenticated auth operation can use it', async () => {
    const db = openDb(':memory:')
    const configured = authFromEnv(db, PASSWORD_ENV)
    await runAuthMigrations(configured.auth!)
    const app = buildApp(db, { authMode: configured.mode, auth: configured.auth })
    const signUp = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'idle@capacitylens.dev', password: 'password-123456', name: 'Idle' },
    })
    const cookie = cookiesOf(signUp)
    db.prepare(`UPDATE session SET updatedAt = ?`).run(
      Date.now() - (SESSION_INACTIVITY_TTL_SECONDS + 1) * 1000,
    )

    // This route is handled by Better Auth itself, so it proves the inactivity check is not only
    // attached to CapacityLens data routes.
    const changed = await call(app, {
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: {
        currentPassword: 'password-123456',
        newPassword: 'Seabird-lantern-47!',
        revokeOtherSessions: true,
      },
    })
    expect(changed.statusCode).toBe(401)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM session`).get() as { n: number }).n).toBe(0)
    expect((await call(app, { method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401)
  })

  it('touches active sessions without extending their absolute expiry', async () => {
    const db = openDb(':memory:')
    const configured = authFromEnv(db, PASSWORD_ENV)
    await runAuthMigrations(configured.auth!)
    const app = buildApp(db, { authMode: configured.mode, auth: configured.auth })
    const signUp = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'active@capacitylens.dev', password: 'password-123456', name: 'Active' },
    })
    const cookie = cookiesOf(signUp)
    const initial = db.prepare(`SELECT expiresAt FROM session`).get() as { expiresAt: string | number }
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000
    db.prepare(`UPDATE session SET updatedAt = ?`).run(twoMinutesAgo)

    expect((await call(app, { method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200)
    const touched = db.prepare(`SELECT updatedAt, expiresAt FROM session`).get() as {
      updatedAt: string | number
      expiresAt: string | number
    }
    expect(new Date(touched.updatedAt).getTime()).toBeGreaterThan(twoMinutesAgo)
    expect(new Date(touched.expiresAt).getTime()).toBe(new Date(initial.expiresAt).getTime())
  })

  it('sign-out invalidates the session again', async () => {
    const app = await appWithAuth(PASSWORD_ENV)
    const signUp = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'out@capacitylens.dev', password: 'password-123456', name: 'Out' },
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
    expect(body.url.startsWith('https://idp.test/authorize')).toBe(true)
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

  it('refuses a half-configured provider instead of silently hiding it', () => {
    expect(() =>
      authFromEnv(openDb(':memory:'), {
        ...PASSWORD_ENV,
        CAPACITYLENS_GITHUB_CLIENT_ID: 'gh-id-only',
      }),
    ).toThrow(/must both be set/i)
  })

  it('is empty (no providers) when no social env is set', () => {
    const { auth } = authFromEnv(openDb(':memory:'), PASSWORD_ENV)
    expect(Object.keys(auth!.options.socialProviders ?? {})).toEqual([])
  })
})

// P1.7 + first-run setup — open email self-registration is closed by default. The single
// bootstrap exception is an empty user table plus the operator's setup token; the gate is enforced
// live per request, so it closes on the very next request after the first identity. The explicit
// CAPACITYLENS_ALLOW_OPEN_SIGNUP=1 escape still re-opens registration unconditionally.
describe('closed self-registration (P1.7) + first-run bootstrap', () => {
  const SETUP_TOKEN = 'unit-test-owner-setup-token-0123456789abcdef'
  /** PASSWORD_ENV but with the open-signup escape removed → default-closed posture. */
  const CLOSED_ENV: Record<string, string> = { ...PASSWORD_ENV, CAPACITYLENS_SETUP_TOKEN: SETUP_TOKEN }
  delete CLOSED_ENV.CAPACITYLENS_ALLOW_OPEN_SIGNUP

  const signUp = (app: FastifyInstance, email = 'late@capacitylens.dev') =>
    call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'x-capacitylens-setup-token': SETUP_TOKEN },
      payload: { email, password: 'password-123456', name: 'Late' },
    })

  it('allows the first sign-up only with the operator setup token, then closes live', async () => {
    const app = await appWithAuth(CLOSED_ENV)
    const first = await signUp(app, 'owner@capacitylens.dev')
    expect(first.statusCode).toBe(200)
    expect(cookiesOf(first)).toContain('capacitylens.session_token')
    // The gate is per REQUEST, not per boot: the very next sign-up on the SAME running app must
    // be refused now that one user exists — Better Auth's unchanged 400
    // EMAIL_PASSWORD_SIGN_UP_DISABLED shape (a boot-time boolean would stay open until restart).
    const second = await signUp(app, 'late@capacitylens.dev')
    expect(second.statusCode).toBe(400)
    expect(cookiesOf(second)).not.toContain('capacitylens.session_token')
  })

  it('serializes concurrent first-owner sign-ups so exactly one identity is created', async () => {
    const app = await appWithAuth(CLOSED_ENV)
    const results = await Promise.all([
      signUp(app, 'owner-one@capacitylens.dev'),
      signUp(app, 'owner-two@capacitylens.dev'),
    ])
    expect(results.filter((res) => res.statusCode === 200)).toHaveLength(1)
    expect(results.filter((res) => res.statusCode !== 200)).toHaveLength(1)
  })

  it('releases the bootstrap claim after success so erasing the sole identity reopens setup', async () => {
    const db = openDb(':memory:')
    const { mode, auth } = authFromEnv(db, CLOSED_ENV)
    await runAuthMigrations(auth!)
    const app = buildApp(db, { authMode: mode, auth })
    expect((await signUp(app, 'first-owner@capacitylens.dev')).statusCode).toBe(200)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM capacitylens_bootstrap_claim`).get() as { n: number }).n).toBe(0)

    db.exec(`DELETE FROM session; DELETE FROM account; DELETE FROM user;`)
    expect((await signUp(app, 'replacement-owner@capacitylens.dev')).statusCode).toBe(200)
  })

  it('refuses a network visitor who lacks the fresh-instance setup token', async () => {
    const app = await appWithAuth(CLOSED_ENV)
    const missing = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'attacker@capacitylens.dev', password: 'password-123456', name: 'Attacker' },
    })
    const wrong = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'x-capacitylens-setup-token': 'wrong-token' },
      payload: { email: 'attacker@capacitylens.dev', password: 'password-123456', name: 'Attacker' },
    })
    expect(missing.statusCode).toBe(400)
    expect(wrong.statusCode).toBe(400)
    expect(cookiesOf(missing)).not.toContain('capacitylens.session_token')
  })

  it('allows sign-up with users already present only when CAPACITYLENS_ALLOW_OPEN_SIGNUP=1', async () => {
    const app = await appWithAuth({ ...CLOSED_ENV, CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1' })
    // First user consumes the bootstrap exception; the second still succeeds because the flag
    // re-opens sign-up unconditionally.
    expect((await signUp(app, 'first@capacitylens.dev')).statusCode).toBe(200)
    const res = await signUp(app)
    expect(res.statusCode).toBe(200)
    expect(cookiesOf(res)).toContain('capacitylens.session_token')
  })

  it('open signup validation failures do not touch the absent bootstrap-claim table', async () => {
    const app = await appWithAuth({ ...CLOSED_ENV, CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1' })
    const invalid = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: 'invalid@capacitylens.dev', password: 'short', name: 'Invalid' },
    })
    expect(invalid.statusCode).toBeGreaterThanOrEqual(400)
    expect(invalid.statusCode).toBeLessThan(500)
  })

  it('keeps the library flag OFF — the live hook owns the gate (disableSignUp stays false)', () => {
    // Better Auth 1.6.20 enforces disableSignUp even for server-side auth.api.signUpEmail
    // (sign-up.mjs:143), so the static flag must stay false in BOTH postures — the closed
    // behaviour above comes from hooks.before, never from this option.
    const open = authFromEnv(openDb(':memory:'), { ...CLOSED_ENV, CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1' })
    const closed = authFromEnv(openDb(':memory:'), CLOSED_ENV)
    expect(open.auth!.options.emailAndPassword?.disableSignUp).toBe(false)
    expect(closed.auth!.options.emailAndPassword?.disableSignUp).toBe(false)
  })

  it('reports needsSetup on the /api/auth/me 401 at zero users, and drops it once a user exists', async () => {
    const app = await appWithAuth(CLOSED_ENV)
    // Zero users: the login screen must offer "Create the owner account" instead of a dead end.
    const before = await call(app, { method: 'GET', url: '/api/auth/me' })
    expect(before.statusCode).toBe(401)
    expect(before.json().needsSetup).toBe(true)
    // The 401 shape still excludes account facts (only authMode/error/needsSetup — no capFields).
    expect(Object.keys(before.json()).sort()).toEqual(['authMode', 'error', 'needsSetup', 'providers'])
    // One user later, the flag is GONE (absent, not false — the client fail-closes on absence).
    expect((await signUp(app, 'owner@capacitylens.dev')).statusCode).toBe(200)
    const after = await call(app, { method: 'GET', url: '/api/auth/me' })
    expect(after.statusCode).toBe(401)
    expect(after.json().needsSetup).toBeUndefined()
  })
})

// First-run owner bootstrap (--create-owner-admin-admin / CAPACITYLENS_CREATE_ADMIN_ADMIN=1):
// createBootstrapAdmin creates admin@admin.admin with a generated password on an EMPTY user
// table, skips (one line, not an error) when users exist, and refuses outside password mode.
describe('first-run owner bootstrap (createBootstrapAdmin)', () => {
  const CLOSED_ENV: Record<string, string> = { ...PASSWORD_ENV }
  delete CLOSED_ENV.CAPACITYLENS_ALLOW_OPEN_SIGNUP

  /** authFromEnv + migrations on a fresh in-memory DB, ready for createBootstrapAdmin. */
  async function bootstrapFixture(env: Record<string, string> = CLOSED_ENV) {
    const db = openDb(':memory:')
    const { mode, auth } = authFromEnv(db, env)
    await runAuthMigrations(auth!)
    return { db, mode, auth }
  }

  it('creates admin@admin.admin on an empty user table and prints the framed credential warning', async () => {
    const { db, mode, auth } = await bootstrapFixture()
    const lines: string[] = []
    expect(await createBootstrapAdmin(db, mode, auth, (l) => lines.push(l))).toBe('created')
    expect(countUsers(db)).toBe(1)
    // The warning must name the EXACT credential — an operator who can't see what to change
    // can't change it.
    const warning = lines.join('\n')
    expect(warning).toContain('password:')
    expect(warning).toContain(BOOTSTRAP_ADMIN_EMAIL)
    expect(warning).not.toContain('password: admin')
  })

  it('signs in with the generated bootstrap password on a later boot without the flag', async () => {
    const { db, mode, auth } = await bootstrapFixture()
    const lines: string[] = []
    await createBootstrapAdmin(db, mode, auth, (line) => lines.push(line))
    const password = /password:\s+([^\s]+)/.exec(lines.join('\n'))?.[1]
    expect(password).toBeTruthy()
    expect(password!.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH)
    // "Restart": a fresh instance on the SAME DB, bootstrap flag absent → floor back at the min.
    const restarted = authFromEnv(db, CLOSED_ENV)
    expect(restarted.auth!.options.emailAndPassword?.minPasswordLength).toBe(MIN_PASSWORD_LENGTH)
    const app = buildApp(db, { authMode: restarted.mode, auth: restarted.auth })
    const signIn = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: BOOTSTRAP_ADMIN_EMAIL, password },
    })
    expect(signIn.statusCode).toBe(200)
    expect(cookiesOf(signIn)).toContain('capacitylens.session_token')
  })

  it('keeps minPasswordLength at the shared floor ALWAYS — flagged boot or not, empty table or not', async () => {
    // The fix (review remediation): the instance-wide floor is never bent. The bootstrap's 5-char
    // password is created through a DIFFERENT path (auth.createCredentialUser(), bypassing the sign-up route
    // entirely — see createBootstrapAdmin) instead of lowering this option.
    const { auth } = await bootstrapFixture()
    expect(auth!.options.emailAndPassword?.minPasswordLength).toBe(MIN_PASSWORD_LENGTH)
    const seeded = await bootstrapFixture()
    await createBootstrapAdmin(seeded.db, seeded.mode, seeded.auth, () => {})
    const populated = authFromEnv(seeded.db, CLOSED_ENV)
    expect(populated.auth!.options.emailAndPassword?.minPasswordLength).toBe(MIN_PASSWORD_LENGTH)
    const plain = authFromEnv(openDb(':memory:'), CLOSED_ENV)
    expect(plain.auth!.options.emailAndPassword?.minPasswordLength).toBe(MIN_PASSWORD_LENGTH)
  })

  it('REJECTS a 5-char sign-up password during a boot where the bootstrap just ran (the floor is never bent for anything else)', async () => {
    const { db, mode, auth } = await bootstrapFixture()
    await createBootstrapAdmin(db, mode, auth, () => {})
    // Same DB, open self-registration so the sign-up ROUTE (not the bootstrap's internalAdapter
    // path) is reachable — this is exactly the "operator's own reset" / "sign-up that boot" case
    // the finding called out: it must NOT inherit any lowered floor.
    const open = authFromEnv(db, { ...CLOSED_ENV, CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1' })
    const app = buildApp(db, { authMode: open.mode, auth: open.auth })
    const res = await call(app, {
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { name: 'short', email: 'short@capacitylens.dev', password: 'admin' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('PASSWORD_TOO_SHORT')
  })

  it('skips with one line (not an error) when users already exist', async () => {
    const { db, mode, auth } = await bootstrapFixture()
    await createBootstrapAdmin(db, mode, auth, () => {})
    const lines: string[] = []
    expect(await createBootstrapAdmin(db, mode, auth, (l) => lines.push(l))).toBe('skipped')
    expect(lines).toEqual(['capacitylens-server: --create-owner-admin-admin skipped: users already exist'])
    expect(countUsers(db)).toBe(1) // no second account, no throw
  })

  it('refuses loudly (AuthConfigError) when auth is off or sso — the flag is meaningless there', async () => {
    await expect(createBootstrapAdmin(openDb(':memory:'), 'off', null)).rejects.toThrow(AuthConfigError)
    const sso = authFromEnv(openDb(':memory:'), SSO_ENV)
    await expect(createBootstrapAdmin(openDb(':memory:'), sso.mode, sso.auth)).rejects.toThrow(AuthConfigError)
  })

  // Finding 1 (review, 2026-07-11): a bare createUser+linkAccount would strand an orphaned,
  // credential-less user forever if linkAccount ever throws — countUsers>0 with no sign-in-able
  // account closes BOTH bootstrap paths permanently. Fixed by createCredentialUserWith's
  // rollback (see auth.ts). This pins the contract end-to-end through createBootstrapAdmin, with
  // ONLY the Better Auth internals faked (createUser/deleteUser hit the real `user` table so
  // countUsers(db) — the real production signal — reflects the outcome truthfully).
  it('rolls back the orphaned user row when linkAccount fails, so a retry bootstrap succeeds (Finding 1)', async () => {
    const { db, mode, auth } = await bootstrapFixture()
    const boom = new Error('linkAccount boom')

    /** A fake Auth whose createCredentialUser drives the REAL createCredentialUserWith against a
     *  fake internal adapter: createUser/deleteUser do real SQL against the migrated `user` table
     *  (so countUsers(db) is meaningful), linkAccount always throws (simulating the failure). */
    const failingAuth: Auth = {
      handler: async () => new Response(null),
      api: { getSession: async () => null, requestPasswordReset: async () => ({ status: true }) },
      options: {},
      providers: [],
      revokeUserSessions: async () => {},
      createCredentialUser: (email, name, password) =>
        createCredentialUserWith(
          {
            password: { hash: async (p) => p },
            internalAdapter: {
              createUser: async (input) => {
                const id = 'orphan-candidate'
                const now = new Date().toISOString()
                db.prepare(
                  `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
                ).run(id, input.name, input.email, input.emailVerified ? 1 : 0, now, now)
                return { id }
              },
              linkAccount: async () => {
                throw boom
              },
              deleteUser: async (userId) => {
                db.prepare(`DELETE FROM user WHERE id = ?`).run(userId)
              },
            },
          },
          email,
          name,
          password,
        ),
      deleteCredentialUser: async (userId) => {
        db.prepare(`DELETE FROM user WHERE id = ?`).run(userId)
      },
    }

    await expect(createBootstrapAdmin(db, mode, failingAuth, () => {})).rejects.toMatchObject({
      message: expect.stringContaining('rolled back'),
      cause: boom,
    })
    // The rollback worked: no orphan left behind, so the table reads truly empty.
    expect(countUsers(db)).toBe(0)

    // Retry on the SAME db with the REAL auth: nothing about the failed attempt blocked it.
    const lines: string[] = []
    expect(await createBootstrapAdmin(db, mode, auth, (l) => lines.push(l))).toBe('created')
    expect(countUsers(db)).toBe(1)
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

  it('password mode refuses a weak first-owner setup token', () => {
    expect(() =>
      authFromEnv(openDb(':memory:'), {
        ...PASSWORD_ENV,
        CAPACITYLENS_SETUP_TOKEN: 'too-short',
      }),
    ).toThrow(/setup_token must be at least 32 bytes/i)
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

  it('rejects plaintext, credential-bearing, and non-HTTP identity-provider endpoints', () => {
    for (const endpoint of [
      'http://identity.example/.well-known/openid-configuration',
      'https://user:secret@identity.example/.well-known/openid-configuration',
      'javascript:alert(1)',
    ]) {
      expect(() => authFromEnv(openDb(':memory:'), {
        ...SSO_ENV,
        CAPACITYLENS_SSO_AUTHORIZATION_URL: undefined,
        CAPACITYLENS_SSO_TOKEN_URL: undefined,
        CAPACITYLENS_SSO_DISCOVERY_URL: endpoint,
      })).toThrow(/https|credentials|URL/i)
    }
  })

  it('permits plaintext provider endpoints only on explicit loopback development hosts', () => {
    expect(() => authFromEnv(openDb(':memory:'), {
      ...SSO_ENV,
      CAPACITYLENS_SSO_AUTHORIZATION_URL: 'http://localhost:9999/authorize',
      CAPACITYLENS_SSO_TOKEN_URL: 'http://127.0.0.1:9999/token',
    })).not.toThrow()
  })

  it('restricts provider ids to route-safe lowercase identifiers', () => {
    for (const providerId of ['UPPER', '../callback', 'sso space', '-sso']) {
      expect(() => authFromEnv(openDb(':memory:'), {
        ...SSO_ENV,
        CAPACITYLENS_SSO_PROVIDER_ID: providerId,
      })).toThrow(/PROVIDER_ID/)
    }
  })

  it('buildApp refuses authMode ≠ off without an auth instance', () => {
    expect(() => buildApp(openDb(':memory:'), { authMode: 'password' })).toThrow(/requires a Better Auth instance/)
  })
})
