import { test, expect } from './fixtures'
import { resetServer, serverState } from './db-helpers'

// Server-backed half of the P1.14 onboarding-lock: a DIRECT API PATCH of a frozen account field
// (language / weekStartsOn / timezone) is rejected with 409. This is the SECURITY backstop — the
// disabled Settings UI is only UX; the freeze is enforced on the server regardless of the client.
const API = process.env.VITE_CAPACITYLENS_API ?? 'http://localhost:8787'

test.describe('database-backed onboarding lock (P1.14)', () => {
  test.beforeEach(async ({ request }) => {
    await resetServer(request, true) // wipe + re-seed so a known account exists
  })

  test('direct PATCHes of changeable frozen fields are rejected and unsupported language is a no-op', async ({
    request,
  }) => {
    const before = await serverState(request)
    const account = before.accounts[0] as {
      id: string
      language?: string
      weekStartsOn?: 0 | 1
      timezone?: string
    }
    expect(account).toBeTruthy()

    const changes = [
      ['weekStartsOn', 1, 0],
      ['timezone', 'UTC', 'Europe/London'],
    ] as const
    for (const [field, initial, target] of changes) {
      // The demo seed deliberately models legacy accounts with these optional fields absent.
      // Missing frozen fields may be initialized once; only a subsequent change is forbidden.
      const initialized = await request.patch(`${API}/api/accounts/${account.id}`, {
        data: { [field]: initial },
      })
      expect(initialized.status(), `${field} must allow one-time initialization`).toBe(200)

      const res = await request.patch(`${API}/api/accounts/${account.id}`, {
        data: { [field]: target },
      })
      expect(res.status(), `${field} must remain frozen`).toBe(409)
    }

    // English is currently the only supported language. An unsupported value is sanitised away,
    // so it cannot express a valid frozen-field change and must remain an unchanged no-op.
    const language = await request.patch(`${API}/api/accounts/${account.id}`, {
      data: { language: 'fr' },
    })
    expect(language.status()).toBe(200)

    // All stored values must remain untouched after every refused request.
    const after = await serverState(request)
    expect(after.accounts[0].language).toBeUndefined()
    expect(after.accounts[0]).toMatchObject({
      weekStartsOn: 1,
      timezone: 'UTC',
    })
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

  test('the account picker lists both seeded companies but hides the New company button', async ({
    page,
  }) => {
    await page.goto('/')
    // Clear the cosmetic demo sign-in gate if it's up (this server reports authMode 'off').
    const signIn = page.getByTestId('fake-sign-in')
    const studioNorth = page.getByRole('button', {
      name: 'Studio North',
      exact: true,
    })
    await signIn.or(studioNorth).first().waitFor()
    if (await signIn.isVisible()) await signIn.click()

    await expect(studioNorth).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Loft Digital', exact: true }),
    ).toBeVisible()
    // GET /api/auth/me reports canCreateAccount: false once ≥1 account exists and
    // CAPACITYLENS_MULTI_ACCOUNT is unset — the button is HIDDEN entirely, not merely disabled.
    await expect(page.getByTestId('new-company-button')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New company' })).toHaveCount(
      0,
    )
  })

  test('a direct API create beyond the cap is rejected 403 with the exact policy message', async ({
    request,
  }) => {
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
    expect(await res.json()).toMatchObject({
      code: 'FORBIDDEN',
      error:
        'This instance allows a single company. Set CAPACITYLENS_MULTI_ACCOUNT=1 to allow more.',
      retryable: false,
    })

    // The rejected create must not have landed — still exactly the two seeded companies.
    const after = await serverState(request)
    expect(after.accounts).toHaveLength(2)
  })
})
