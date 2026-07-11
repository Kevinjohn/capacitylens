import { expect, request as playwrightRequest } from '@playwright/test'

// Shared plumbing for the auth-backed Playwright specs (*.auth.spec.ts), which all run against the
// auth-e2e server (CAPACITYLENS_AUTH=password on :8887 — see playwright.config.ts). Extracted here so
// the bootstrap token, sign-up payload shape, and Set-Cookie collapse live in ONE place rather than a
// copy per spec (they were duplicated across members/invite/viewer/login/reset-password).

/** The auth-e2e API origin (the password-auth server the *.auth specs drive). */
export const AUTH_API = 'http://localhost:8887'

/** The password every auth-e2e fixture signs up / signs in with. */
export const AUTH_PASSWORD = 'demo-password-123'

/** The operator bootstrap token (set in server's start:auth-e2e script). The auth-e2e DB is SEEDED,
 *  so a fresh sign-up is not a first-run bootstrap and holds no membership — this is the documented
 *  operator path to provision an org (`POST /api/orgs`) on an already-populated instance. */
export const BOOTSTRAP_TOKEN = 'auth-e2e-bootstrap-token-0123456789abcdef'

/** Collapse a response's Set-Cookie header(s) into one request Cookie header. */
export function cookiesOf(setCookie: string): string {
  return setCookie
    .split('\n')
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ')
}

/**
 * Sign up ONE user in an ISOLATED request context and return its email, auto-signed-in session
 * cookie, and resolved user id.
 *
 * Each user gets its own context on purpose: a shared APIRequestContext keeps a cookie jar, and
 * Better Auth refuses a sign-up that arrives already-authenticated — so signing up B over A's jar
 * would fail. Better Auth auto-signs-in on sign-up, so the Set-Cookie IS the session (mirrors the
 * server unit fixtures, which never call sign-in/email). Emails are unique per run (callers stamp
 * them), so a reused server never collides on a duplicate.
 */
export async function signUpUser(email: string): Promise<{ email: string; cookie: string; userId: string }> {
  const ctx = await playwrightRequest.newContext()
  try {
    const res = await ctx.post(`${AUTH_API}/api/auth/sign-up/email`, {
      data: { email, password: AUTH_PASSWORD, name: email.split('@')[0] },
    })
    expect(res.ok(), `sign-up ${email}`).toBeTruthy()
    const cookie = cookiesOf(res.headers()['set-cookie'] ?? '')
    const me = await ctx.get(`${AUTH_API}/api/auth/me`, { headers: { cookie } })
    const userId = (await me.json()).user.id as string
    return { email, cookie, userId }
  } finally {
    await ctx.dispose()
  }
}
