import { test, expect, request as playwrightRequest } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

test.use({ reducedMotion: 'reduce' })

// P1.9 — invite accept, against the auth-backed project's server (CAPACITYLENS_AUTH=password on
// :8887 — see playwright.config.ts). Owner A signs up, bootstraps an org (via the operator bootstrap
// token, since the auth-e2e DB is seeded so A is not first-run), and mints an editor invite token via
// POST /api/invites. User B then opens /invite/<token> in the browser: the login wall shows first, B
// signs in, and the accept POST binds B as an editor — the "joined" success state. Finally we assert
// the API-layer single-use guarantee (re-POSTing the same token is 409). Browser-agnostic (no UA
// branching).

const API = 'http://localhost:8887'
const PASSWORD = 'demo-password-123'
// The auth-e2e server is SEEDED (Studio North + Loft Digital), so a fresh sign-up is not a
// first-run bootstrap and holds no membership — /api/orgs would 403. The bootstrap token (set in
// server's start:auth-e2e script) is the documented operator path to provision an org on an
// already-populated instance, so A can mint its own owned account to invite into.
const BOOTSTRAP_TOKEN = 'auth-e2e-bootstrap-token-0123456789abcdef'
// Unique per run so reruns against a reused auth server don't collide on existing users/accounts.
const STAMP = Date.now()
const OWNER = `owner-${STAMP}@capacitylens.dev`
const JOINER = `joiner-${STAMP}@capacitylens.dev`

/** Collapse a response's Set-Cookie header(s) into one request Cookie header. */
function cookiesOf(setCookie: string): string {
  return setCookie
    .split('\n')
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ')
}

/**
 * Sign up ONE user in an ISOLATED request context and return its auto-signed-in session cookie.
 *
 * Each user gets its own context on purpose: a shared APIRequestContext keeps a cookie jar, and
 * Better Auth refuses a sign-up that arrives already-authenticated — so signing up B over A's jar
 * would fail. Better Auth auto-signs-in on sign-up, so the Set-Cookie IS the session (mirrors the
 * server unit fixtures, which never call sign-in/email). Emails are unique per run, so a reused
 * server never collides on a duplicate.
 */
async function signUpInIsolatedContext(email: string): Promise<string> {
  const ctx: APIRequestContext = await playwrightRequest.newContext()
  try {
    const res = await ctx.post(`${API}/api/auth/sign-up/email`, {
      data: { email, password: PASSWORD, name: 'Tester' },
    })
    expect(res.ok(), `sign-up ${email}`).toBeTruthy()
    return cookiesOf(res.headers()['set-cookie'] ?? '')
  } finally {
    await ctx.dispose()
  }
}

test.describe('invite accept (CAPACITYLENS_AUTH=password)', () => {
  test('a signed-in user opens a valid invite link and joins; reusing the token is 409', async ({
    page,
    request,
  }) => {
    // Owner A: sign up (auto-signed-in → session cookie), bootstrap an org, mint an invite. The
    // explicit `cookie` header (not the shared jar) carries A's session on each call.
    const ownerCookie = await signUpInIsolatedContext(OWNER)

    const orgRes = await request.post(`${API}/api/orgs`, {
      headers: { cookie: ownerCookie, 'x-capacitylens-bootstrap-token': BOOTSTRAP_TOKEN },
      data: { name: `Invite Studio ${STAMP}` },
    })
    expect(orgRes.status()).toBe(201)
    const accountId = (await orgRes.json()).id as string

    const inviteRes = await request.post(`${API}/api/invites`, {
      headers: { cookie: ownerCookie },
      data: { accountId, role: 'editor' },
    })
    expect(inviteRes.status()).toBe(201)
    const token = (await inviteRes.json()).token as string
    expect(token.length).toBeGreaterThan(0)

    // User B exists (sign-up is API-only; keep B's session cookie for the API reuse check below).
    // Opening /invite/<token> in the browser hits the login wall first (the browser page has no
    // session), then the accept runs after B signs in.
    const joinerCookie = await signUpInIsolatedContext(JOINER)
    await page.goto(`/invite/${token}`)

    // The auth wall: the login screen, NOT the invite page, until B signs in.
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await page.getByLabel('Email').fill(JOINER)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // After sign-in AuthProvider reloads onto the same /invite/<token> URL; the accept POST binds
    // B as an editor and the success state renders.
    await expect(page.getByText(/You’ve joined this company/)).toBeVisible()

    // Single-use guarantee at the API layer: the browser accept already consumed the token, so a
    // second accept (B's API session) of the same token is 409.
    const reuse = await request.post(`${API}/api/invites/${token}/accept`, {
      headers: { cookie: joinerCookie },
    })
    expect(reuse.status()).toBe(409)
  })
})
