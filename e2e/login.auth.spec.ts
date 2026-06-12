import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.use({ reducedMotion: 'reduce' })

// US-NAV-10: the flag-gated login wall, against the auth-backed project's server
// (FLOATY_AUTH=password on :8887 — see playwright.config.ts). The default deploy keeps
// auth off, so this is the ONLY place the login screen exists; the rest of the suite
// running unchanged in the other two projects is the off-guarantee.

const API = 'http://localhost:8887'
const EMAIL = 'tester@floaty.dev'
const PASSWORD = 'demo-password-123'

// Sign-up is API-only this round (no form). Idempotent: a rerun against a reused server
// hits USER_ALREADY_EXISTS (422), which is fine — the user exists either way.
async function seedUser(request: APIRequestContext) {
  const res = await request.post(`${API}/api/auth/sign-up/email`, {
    data: { email: EMAIL, password: PASSWORD, name: 'Tester' },
  })
  if (!res.ok()) expect(res.status()).toBe(422)
}

test.describe('login screen (FLOATY_AUTH=password)', () => {
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
    await seedUser(request)
    await page.goto('/')
    await page.getByLabel('Email').fill(EMAIL)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // The normal boot flow resumes: server-seeded company picker → the app.
    // exact: true — a bare /Studio North/ would also match "Delete Studio North".
    await page.getByRole('button', { name: 'Studio North', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()

    // Settings gains the Account section only on an auth-enabled deploy.
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
    await expect(page.getByText(`Signed in as ${EMAIL}`)).toBeVisible()
    await page.getByRole('button', { name: 'Sign out' }).click()

    // Session gone: back behind the wall, and a reload stays there.
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })
})
