import { describe, it, expect } from 'vitest'
import { openDb } from './db'
import { authFromEnv } from './auth'

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

  it('ties Secure to the threaded https flag — false when https omitted/false (so plain-HTTP login works)', () => {
    // Default (no https opt) and explicit https:false → Secure OFF. A Secure cookie over plain HTTP
    // is dropped by the browser → an endless login loop; the default deploy is HTTP behind a proxy.
    expect(authFromEnv(openDb(':memory:'), PASSWORD_ENV).auth!.options.advanced?.useSecureCookies).toBe(false)
    expect(
      authFromEnv(openDb(':memory:'), PASSWORD_ENV, { https: false }).auth!.options.advanced?.useSecureCookies,
    ).toBe(false)
  })

  it('sets Secure when https:true is threaded (real HTTPS origin)', () => {
    const { auth } = authFromEnv(openDb(':memory:'), PASSWORD_ENV, { https: true })
    expect(auth!.options.advanced?.useSecureCookies).toBe(true)
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
