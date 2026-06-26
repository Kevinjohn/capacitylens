import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.use({ reducedMotion: 'reduce' })

// US-NAV-10: the flag-gated login wall, against the auth-backed project's server
// (CAPACITYLENS_AUTH=password on :8887 — see playwright.config.ts). The default deploy keeps
// auth off, so this is the ONLY place the login screen exists; the rest of the suite
// running unchanged in the other two projects is the off-guarantee.

const API = 'http://localhost:8887'
const EMAIL = 'tester@capacitylens.dev'
const PASSWORD = 'demo-password-123'
// Same dev-only token the auth-e2e server boots with (server/package.json start:auth-e2e) — mirrors
// members.auth/viewer.auth. P1.13: a fresh user has NO membership, so GET /api/accounts is empty and
// the picker would have nothing to pick. We bootstrap this login its own org via POST /api/orgs (which
// makes the caller its Owner) so the picker then lists it. account_members is a server-only control
// table excluded from the shared seed, so a membership CAN'T be pre-seeded — bootstrapping is the path.
const BOOTSTRAP_TOKEN = 'auth-e2e-bootstrap-token-0123456789abcdef'
const ORG_NAME = `Login Studio ${Date.now()}`

/** Collapse a response's Set-Cookie header(s) into one request Cookie header. */
function cookiesOf(setCookie: string): string {
  return setCookie
    .split('\n')
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ')
}

// Sign-up is API-only this round (no form). Idempotent for the FIXED EMAIL: a rerun against a reused
// server hits USER_ALREADY_EXISTS (422), which is fine — the user exists either way.
async function seedUser(request: APIRequestContext, email = EMAIL) {
  const res = await request.post(`${API}/api/auth/sign-up/email`, {
    data: { email, password: PASSWORD, name: 'Tester' },
  })
  if (!res.ok()) expect(res.status()).toBe(422)
}

/** Sign up a FRESH (unique) user and return its email + session cookie. Used by the org-bootstrap test
 *  so sign-up always succeeds (yielding a cookie) even when the auth-e2e DB is reused across local
 *  reruns — Better Auth returns the session cookie on sign-up (members.auth/viewer.auth use the same). */
async function signUpFresh(request: APIRequestContext): Promise<{ email: string; cookie: string }> {
  const email = `login-${Date.now()}@capacitylens.dev`
  const res = await request.post(`${API}/api/auth/sign-up/email`, {
    data: { email, password: PASSWORD, name: 'Tester' },
  })
  expect(res.ok(), `sign-up ${email}`).toBeTruthy()
  return { email, cookie: cookiesOf(res.headers()['set-cookie'] ?? '') }
}

test.describe('login screen (CAPACITYLENS_AUTH=password)', () => {
  test('unauthenticated visit shows the login screen, not the app — and the API 401s', async ({
    page,
    request,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    // The wall is total: no company picker, no nav, no data.
    await expect(page.getByRole('heading', { name: 'Choose a company' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Schedule' })).toHaveCount(0)
    expect((await request.get(`${API}/api/state`)).status()).toBe(401)

    // A wrong password fails inline, on the same screen.
    await seedUser(request)
    await page.getByLabel('Email').fill(EMAIL)
    await page.getByLabel('Password').fill('not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

    // a11y oracle while the screen is up (US-NAV-10 acceptance).
    const results = await new AxeBuilder({ page }).analyze()
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(
      blocking,
      JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2),
    ).toEqual([])
  })

  test('signing in reveals the app; signing out from Settings returns to the login screen', async ({
    page,
    request,
  }) => {
    // P1.13: bootstrap THIS login its own org so the picker (now sourced from the login's memberships
    // via GET /api/accounts) has something to list. A FRESH per-run user guarantees the sign-up cookie
    // (no 422 on a reused DB); /api/orgs makes the caller the org's Owner.
    const { email, cookie } = await signUpFresh(request)
    const orgRes = await request.post(`${API}/api/orgs`, {
      headers: { cookie, 'x-capacitylens-bootstrap-token': BOOTSTRAP_TOKEN },
      data: { name: ORG_NAME },
    })
    expect(orgRes.status()).toBe(201)

    await page.goto('/')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // The boot flow resumes: the picker lists ONLY this login's memberships (P1.13) → pick our org →
    // the active account hydrates its slice via GET /api/state?accountId= → the post-login intro → app.
    // exact: true — a bare name would also match a "Delete <name>" control.
    await page.getByRole('button', { name: ORG_NAME, exact: true }).click()
    // The "What CapacityLens is" intro gate fires after the company pick in every entry mode (incl. real
    // auth — they all converge on a chosen account); dismiss it to reach the app.
    await expect(page.getByRole('heading', { name: 'Welcome to CapacityLens' })).toBeVisible()
    await page.getByTestId('intro-continue').click()
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()

    // Settings gains the Account section only on an auth-enabled deploy.
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
    await page.getByRole('button', { name: 'Sign out' }).click()

    // Session gone: back behind the wall, and a reload stays there.
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('a login with NO memberships sees an EMPTY picker (tenant isolation — no cross-tenant leak)', async ({
    page,
    request,
  }) => {
    // P1.13 isolation: a fresh user with NO org bootstrapped sees no companies — the picker lists ONLY
    // the login's memberships, never another tenant's org (the no-arg whole read that leaked all tenants
    // is closed in auth-on). They CAN still create their own (the New company button is present).
    const lonely = `lonely-${Date.now()}@capacitylens.dev`
    await seedUser(request, lonely)
    await page.goto('/')
    await page.getByLabel('Email').fill(lonely)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Past the wall, on the picker — but with no company button (no other tenant's org leaked in).
    await expect(page.getByRole('heading', { name: 'Choose a company' })).toBeVisible()
    await expect(page.getByText(/No companies yet/)).toBeVisible()
    await expect(page.getByRole('button', { name: ORG_NAME, exact: true })).toHaveCount(0)
    // The escape hatch is intact: they may create their own org.
    await expect(page.getByRole('button', { name: 'New company' })).toBeVisible()
  })
})
