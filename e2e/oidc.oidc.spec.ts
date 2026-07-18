import { expect, test, type Page } from '@playwright/test'

async function completeDexSignIn(
  page: Page,
  email: string,
): Promise<void> {
  const login = page.getByRole('button', { name: /login/i })
  const approve = page.getByRole('button', { name: 'Grant Access', exact: true })
  await expect(login.or(approve)).toBeVisible()
  if (await login.isVisible()) {
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).fill('password')
    await login.click()
  }
  await expect(approve).toBeVisible()
  await approve.click()
}

test.describe('strict OIDC account front door', () => {
  test.describe.configure({ mode: 'serial' })
  test('completes bootstrap, invitation, callback, membership, and local sign-out flows', async ({ page, browser }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByText(/experimental/i)).toHaveCount(0)

    await page.getByRole('button', { name: 'Continue with Single sign-on' }).click()
    await expect(page).toHaveURL(/127\.0\.0\.1:5556\/dex\/auth/)
    await completeDexSignIn(page, 'oidc-owner@example.com')

    await expect(page).toHaveURL(/^http:\/\/localhost:5473\//)
    const me = await page.request.get('/api/auth/me')
    const meBody = await me.json()
    expect(me.status(), JSON.stringify(meBody)).toBe(200)
    expect(meBody).toMatchObject({
      authMode: 'sso',
      user: { email: 'oidc-owner@example.com', emailVerified: true },
      providers: [{ id: 'sso', kind: 'oidc', experimental: false }],
    })
    await expect(page.getByRole('heading', { name: 'Start planning' })).toBeVisible()
    await expect(page.getByTestId('new-company-button')).toBeVisible()

    const commandHeaders = () => {
      return {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
        'X-Account-Command-Id': crypto.randomUUID(),
      }
    }
    const created = await page.request.post('/api/orgs', {
      headers: commandHeaders(),
      data: { name: 'OIDC conformance company' },
    })
    expect(created.status()).toBe(201)
    const workspace = await created.json() as { id: string }

    const invitation = await page.request.post('/api/invites', {
      headers: commandHeaders(),
      data: {
        accountId: workspace.id,
        role: 'editor',
        preauthEmail: 'oidc-member@example.com',
      },
    })
    expect(invitation.status()).toBe(201)
    const invite = await invitation.json() as { token: string }

    const memberContext = await browser.newContext()
    const memberPage = await memberContext.newPage()
    await memberPage.goto(`/invite/${encodeURIComponent(invite.token)}`)
    await expect(memberPage.getByTestId('invite-preview')).toContainText('OIDC conformance company')
    await memberPage.getByRole('button', { name: 'Continue with Single sign-on' }).click()
    await completeDexSignIn(memberPage, 'oidc-member@example.com')

    await expect(memberPage).toHaveURL(`http://localhost:5473/invite/${encodeURIComponent(invite.token)}`)
    await memberPage.getByRole('button', { name: /accept invite/i }).click()
    await expect(memberPage.getByRole('status')).toContainText(/joined/i)
    const accounts = await memberPage.request.get('/api/accounts')
    expect(accounts.status()).toBe(200)
    expect(await accounts.json()).toEqual([
      expect.objectContaining({ id: workspace.id, role: 'editor' }),
    ])

    // Product sign-out ends only the local application session. Whether the upstream provider
    // silently reuses its own session is provider policy, not a product guarantee. Reauthenticate
    // through the front door and prove that the stable issuer/subject recovers the same membership.
    // Exercise the same same-origin browser request shape as the product client. A detached
    // APIRequestContext intentionally lacks the browser Origin metadata used by the auth layer's
    // CSRF check, so it is not a valid substitute for this flow.
    const signOutStatus = await memberPage.evaluate(async () => {
      const response = await fetch('/api/account/sign-out', {
        method: 'POST',
        credentials: 'include',
      })
      return response.status
    })
    expect(signOutStatus).toBe(200)
    await memberPage.goto('/')
    await expect(memberPage.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await memberPage.getByRole('button', { name: 'Continue with Single sign-on' }).click()
    const dexLogin = memberPage.getByRole('button', { name: /login/i })
    const dexApproval = memberPage.getByRole('button', { name: 'Grant Access', exact: true })
    const recoveredMembership = memberPage.getByText('OIDC conformance company')
    // Dex may reuse its upstream browser session or ask for credentials again. Both are valid OIDC
    // behavior; the product guarantee is that either front-door path recovers the same local
    // issuer/subject binding and membership.
    await expect(dexLogin.or(dexApproval).or(recoveredMembership)).toBeVisible()
    if (await dexLogin.isVisible() || await dexApproval.isVisible()) {
      await completeDexSignIn(memberPage, 'oidc-member@example.com')
    }
    await expect(memberPage).toHaveURL(/^http:\/\/localhost:5473\//)
    await expect(recoveredMembership).toBeVisible()
    await memberContext.close()
  })

  test('surfaces a provider denial at the product sign-in front door', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Continue with Single sign-on' }).click()
    await expect(page).toHaveURL(/127\.0\.0\.1:5556\/dex\/auth/)
    const state = new URL(page.url()).searchParams.get('state')
    expect(state).toBeTruthy()
    // A standards-shaped negative authorization response. Dex's own Cancel button renders a Dex
    // error page instead of redirecting, so drive the response every interoperable RP must handle.
    await page.goto(
      `/api/auth/oauth2/callback/sso?error=access_denied&state=${encodeURIComponent(state!)}`,
    )

    await expect(page).toHaveURL(/^http:\/\/localhost:5473\//)
    await expect(page.getByRole('alert')).toContainText('Single sign-on was not completed')
    expect((await page.request.get('/api/auth/me')).status()).toBe(401)
  })

  test('surfaces a callback failure without echoing provider-controlled detail', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Continue with Single sign-on' }).click()
    await expect(page).toHaveURL(/127\.0\.0\.1:5556\/dex\/auth/)
    const state = new URL(page.url()).searchParams.get('state')
    expect(state).toBeTruthy()
    await page.goto(
      `/api/auth/oauth2/callback/sso?error=server_error&error_description=${encodeURIComponent('provider secret detail')}&state=${encodeURIComponent(state!)}`,
    )

    await expect(page).toHaveURL(/^http:\/\/localhost:5473\//)
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Single sign-on was not completed')
    await expect(alert).not.toContainText('provider secret detail')
  })

  test('@discovery-fault @malformed-discovery surfaces malformed discovery as a retryable browser error', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Continue with Single sign-on' }).click()
    await expect(page).toHaveURL(/^http:\/\/localhost:5473\//)
    await expect(page.getByRole('alert')).toContainText('Single sign-on was not completed')
  })

  test('@discovery-fault @unavailable-discovery surfaces provider unavailability as a retryable browser error', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Continue with Single sign-on' }).click()
    await expect(page).toHaveURL(/^http:\/\/localhost:5473\//)
    await expect(page.getByRole('alert')).toContainText('Single sign-on was not completed')
  })
})
