import { test, expect } from '@playwright/test'
import { resetServer, serverState } from './db-helpers'

// Server-backed half of the P1.14 onboarding-lock: a DIRECT API PATCH of a frozen account field
// (language / weekStartsOn / timezone) is rejected with 409. This is the SECURITY backstop — the
// disabled Settings UI is only UX; the freeze is enforced on the server regardless of the client.
const API = process.env.VITE_CAPACITYLENS_API ?? 'http://localhost:8787'

test.describe('database-backed onboarding lock (P1.14)', () => {
  test.beforeEach(async ({ request }) => {
    await resetServer(request, true) // wipe + re-seed so a known account exists
  })

  test('a direct PATCH of a frozen field (weekStartsOn) is rejected 409 and leaves the value unchanged', async ({ request }) => {
    const before = await serverState(request)
    const account = before.accounts[0]
    expect(account).toBeTruthy()
    const beforeWeekStart = (account as { weekStartsOn?: 0 | 1 }).weekStartsOn

    // Flip to the OTHER value so it's always a real change regardless of the seed's default.
    const target = beforeWeekStart === 0 ? 1 : 0
    const res = await request.patch(`${API}/api/accounts/${account.id}`, {
      data: { weekStartsOn: target },
    })
    expect(res.status()).toBe(409)

    // The stored value must be untouched.
    const after = await serverState(request)
    expect((after.accounts[0] as { weekStartsOn?: 0 | 1 }).weekStartsOn).toBe(beforeWeekStart)
  })
})

// Client half of the single-company-per-instance policy. This server (`start:e2e`) runs WITHOUT
// CAPACITYLENS_MULTI_ACCOUNT, so the cap is ACTIVE; resetServer's seed (Studio North + Loft
// Digital) is exempt from it (the reset route bypasses the create-time gate), giving a
// deterministic "already at the cap" instance to assert the client's affordance-hiding against.
// The server 403 (asserted below via a direct API call) is the real backstop — the picker's
// missing button is UX only.
test.describe('single-company-per-instance policy (client-side affordance + server backstop)', () => {
  test.beforeEach(async ({ request }) => {
    await resetServer(request, true) // wipe + re-seed: TWO companies, exempt from the create-time cap
  })

  test('the account picker lists both seeded companies but hides the New company button', async ({ page }) => {
    await page.goto('/')
    // Clear the cosmetic demo sign-in gate if it's up (this server reports authMode 'off').
    const signIn = page.getByTestId('fake-sign-in')
    const studioNorth = page.getByRole('button', { name: 'Studio North', exact: true })
    await signIn.or(studioNorth).first().waitFor()
    if (await signIn.isVisible()) await signIn.click()

    await expect(studioNorth).toBeVisible()
    await expect(page.getByRole('button', { name: 'Loft Digital', exact: true })).toBeVisible()
    // GET /api/auth/me reports canCreateAccount: false once ≥1 account exists and
    // CAPACITYLENS_MULTI_ACCOUNT is unset — the button is HIDDEN entirely, not merely disabled.
    await expect(page.getByTestId('new-company-button')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New company' })).toHaveCount(0)
  })

  test('a direct API create beyond the cap is rejected 403 with the exact policy message', async ({ request }) => {
    const res = await request.post(`${API}/api/accounts`, {
      data: {
        id: `e2e-cap-check-${Date.now()}`,
        name: 'Should Not Exist',
        color: '#3b82f6',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    })
    expect(res.status()).toBe(403)
    expect(await res.json()).toEqual({
      error: 'This instance allows a single company. Set CAPACITYLENS_MULTI_ACCOUNT=1 to allow more.',
    })

    // The rejected create must not have landed — still exactly the two seeded companies.
    const after = await serverState(request)
    expect(after.accounts).toHaveLength(2)
  })
})
