import { expect, test } from '@playwright/test'

test.describe('strict OIDC account front door', () => {
  test('completes bootstrap, invitation, callback, membership, and local sign-out flows', async ({ page, browser }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByText(/experimental/i)).toHaveCount(0)

    await page.getByRole('button', { name: 'Continue with Single sign-on' }).click()
    await expect(page).toHaveURL(/127\.0\.0\.1:5556\/dex\/auth/)
    await page.getByLabel(/email/i).fill('oidc-owner@example.com')
    await page.getByLabel(/password/i).fill('password')
    await page.getByRole('button', { name: /login/i }).click()

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
    await memberPage.getByLabel(/email/i).fill('oidc-member@example.com')
    await memberPage.getByLabel(/password/i).fill('password')
    await memberPage.getByRole('button', { name: /login/i }).click()

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
    const recoveredMembership = memberPage.getByText('OIDC conformance company')
    // Dex may reuse its upstream browser session or ask for credentials again. Both are valid OIDC
    // behavior; the product guarantee is that either front-door path recovers the same local
    // issuer/subject binding and membership.
    await expect(dexLogin.or(recoveredMembership)).toBeVisible()
    if (await dexLogin.isVisible()) {
      await memberPage.getByLabel(/email/i).fill('oidc-member@example.com')
      await memberPage.getByLabel(/password/i).fill('password')
      await dexLogin.click()
    }
    await expect(memberPage).toHaveURL(/^http:\/\/localhost:5473\//)
    await expect(recoveredMembership).toBeVisible()
    await memberContext.close()
  })
})
