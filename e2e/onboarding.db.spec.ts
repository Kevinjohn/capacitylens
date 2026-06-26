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
