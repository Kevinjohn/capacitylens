import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test'

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

/** Shared sign-up POST, factored out so the cookie-only and id-resolving variants below don't
 *  duplicate the request shape. Returns the collapsed session cookie. */
async function postSignUp(ctx: APIRequestContext, email: string): Promise<string> {
  const res = await ctx.post(`${AUTH_API}/api/auth/sign-up/email`, {
    data: { email, password: AUTH_PASSWORD, name: email.split('@')[0] },
  })
  expect(res.ok(), `sign-up ${email}`).toBeTruthy()
  return cookiesOf(res.headers()['set-cookie'] ?? '')
}

/**
 * Sign up ONE user in an ISOLATED request context and return its email + auto-signed-in session
 * cookie — ONE HTTP request. This is the cheap default: use it whenever the test only needs the
 * cookie to drive further API calls or a browser sign-in. If the test needs the user's id (e.g. to
 * target them in a PATCH/DELETE `.../members/<userId>` or a `toUserId` transfer), use
 * `signUpUserWithId` instead — it costs a second round trip (`GET /api/auth/me`) to resolve it.
 *
 * Each user gets its own context on purpose: a shared APIRequestContext keeps a cookie jar, and
 * Better Auth refuses a sign-up that arrives already-authenticated — so signing up B over A's jar
 * would fail. Better Auth auto-signs-in on sign-up, so the Set-Cookie IS the session (mirrors the
 * server unit fixtures, which never call sign-in/email). Emails are unique per run (callers stamp
 * them), so a reused server never collides on a duplicate.
 */
export async function signUpUser(email: string): Promise<{ email: string; cookie: string }> {
  const ctx = await playwrightRequest.newContext()
  try {
    const cookie = await postSignUp(ctx, email)
    return { email, cookie }
  } finally {
    await ctx.dispose()
  }
}

/**
 * Sign up ONE user and ALSO resolve its user id (a second request, `GET /api/auth/me`, on top of
 * the sign-up). Use this only when the test actually needs the id — everyone else should use the
 * cheaper `signUpUser` above. See its TSDoc for the isolated-context rationale.
 */
export async function signUpUserWithId(email: string): Promise<{ email: string; cookie: string; userId: string }> {
  const ctx = await playwrightRequest.newContext()
  try {
    const cookie = await postSignUp(ctx, email)
    const me = await ctx.get(`${AUTH_API}/api/auth/me`, { headers: { cookie } })
    const userId = (await me.json()).user.id as string
    return { email, cookie, userId }
  } finally {
    await ctx.dispose()
  }
}
