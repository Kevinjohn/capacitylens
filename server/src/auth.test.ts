import { describe, it, expect } from 'vitest'
import { openDb } from './db'
import { authFromEnv, externalIdentityAllowed } from './auth'

// P1.16 — session-cookie + session-lifetime hardening, asserted by INTROSPECTING the resolved
// betterAuth options (auth.options is the exact object we passed; same robust point P1.7 uses for
// socialProviders). These are auth-ON-only: in OFF mode betterAuth is never constructed, so there
// are no options to harden — authFromEnv returns { mode:'off', auth:null } untouched.

const PASSWORD_ENV = {
  CAPACITYLENS_AUTH: 'password',
  BETTER_AUTH_SECRET: 'unit-test-secret-0123456789abcdef-0123', // 32+ chars (MIN_BETTER_AUTH_SECRET_LENGTH)
  BETTER_AUTH_URL: 'http://localhost:8787',
}

describe('cookie/session hardening (P1.16)', () => {
  it('pins sameSite:lax + httpOnly on the session cookie', () => {
    const { auth } = authFromEnv(openDb(':memory:'), PASSWORD_ENV)
    expect(auth!.options.advanced?.defaultCookieAttributes).toEqual({ sameSite: 'lax', httpOnly: true })
  })

  it('derives an insecure development cookie from an HTTP public URL', () => {
    expect(authFromEnv(openDb(':memory:'), PASSWORD_ENV).auth!.options.advanced?.useSecureCookies).toBe(false)
  })

  it('sets Secure from the HTTPS browser-facing Better Auth URL even behind an HTTP proxy hop', () => {
    const { auth } = authFromEnv(openDb(':memory:'), {
      ...PASSWORD_ENV,
      BETTER_AUTH_URL: 'https://capacity.example',
    })
    expect(auth!.options.advanced?.useSecureCookies).toBe(true)
  })

  it('refuses a plaintext non-loopback public URL in production', () => {
    expect(() =>
      authFromEnv(openDb(':memory:'), {
        ...PASSWORD_ENV,
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'http://capacity.example',
      }),
    ).toThrow(/must use https:\/\//)
  })

  it('still permits loopback HTTP for a local production-container check', () => {
    expect(() =>
      authFromEnv(openDb(':memory:'), {
        ...PASSWORD_ENV,
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'http://localhost:8787',
      }),
    ).not.toThrow()
  })

  it('pins the session lifetime to 7-day expiry / 1-day rolling refresh (seconds)', () => {
    const { auth } = authFromEnv(openDb(':memory:'), PASSWORD_ENV)
    expect(auth!.options.session?.expiresIn).toBe(604800) // 60*60*24*7
    expect(auth!.options.session?.updateAge).toBe(86400) // 60*60*24
  })

  it('OFF mode constructs no betterAuth instance — nothing to harden (auth === null)', () => {
    const { mode, auth } = authFromEnv(openDb(':memory:'), { CAPACITYLENS_AUTH: 'off' })
    expect(mode).toBe('off')
    expect(auth).toBeNull()
  })
})

describe('external identity creation gate', () => {
  it('stays enforced when open email registration is deliberately enabled', async () => {
    const db = openDb(':memory:')
    const { auth } = authFromEnv(db, {
      ...PASSWORD_ENV,
      CAPACITYLENS_ALLOW_OPEN_SIGNUP: '1',
      CAPACITYLENS_GOOGLE_CLIENT_ID: 'google-client',
      CAPACITYLENS_GOOGLE_CLIENT_SECRET: 'google-secret',
    })
    const before = auth!.options.databaseHooks?.user?.create?.before
    expect(before).toBeTypeOf('function')

    await expect(
      before!(
        { email: 'stranger@example.com', emailVerified: true } as never,
        { path: '/callback/google' } as never,
      ),
    ).rejects.toThrow(/not invited/)
  })

  it('allows only a verified, explicitly allow-listed first identity', () => {
    const db = openDb(':memory:')
    authFromEnv(db, PASSWORD_ENV) // initializes Better Auth's user table
    const env = { CAPACITYLENS_SSO_BOOTSTRAP_EMAILS: ' owner@example.com, second@example.com ' }
    expect(externalIdentityAllowed(db, env, { email: 'OWNER@example.com', emailVerified: true })).toBe(true)
    expect(externalIdentityAllowed(db, env, { email: 'owner@example.com', emailVerified: false })).toBe(false)
    expect(externalIdentityAllowed(db, env, { email: 'stranger@example.com', emailVerified: true })).toBe(false)
  })

  it('allows a verified email with a live unused pre-authorised invite', () => {
    const db = openDb(':memory:')
    authFromEnv(db, PASSWORD_ENV)
    db.prepare(`INSERT INTO invites
      (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`)
      .run('hash', 'invite-1', 'account-1', 'viewer', 'person@example.com', '2999-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')

    expect(externalIdentityAllowed(db, {}, { email: ' Person@Example.com ', emailVerified: true })).toBe(true)
    expect(externalIdentityAllowed(db, {}, { email: 'person@example.com', emailVerified: false })).toBe(false)
  })

  it('rejects expired and consumed invitations', () => {
    const db = openDb(':memory:')
    authFromEnv(db, PASSWORD_ENV)
    const insert = db.prepare(`INSERT INTO invites
      (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    insert.run('expired-hash', 'expired', 'account-1', 'viewer', 'expired@example.com', '2000-01-01T00:00:00.000Z', null, '1999-01-01T00:00:00.000Z')
    insert.run('used-hash', 'used', 'account-1', 'viewer', 'used@example.com', '2999-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    expect(externalIdentityAllowed(db, {}, { email: 'expired@example.com', emailVerified: true })).toBe(false)
    expect(externalIdentityAllowed(db, {}, { email: 'used@example.com', emailVerified: true })).toBe(false)
  })
})
