import { test, expect } from '@playwright/test'
import { AUTH_API as API, AUTH_PASSWORD as PASSWORD, BOOTSTRAP_TOKEN, signUpUser } from './auth-helpers'

test.use({ reducedMotion: 'reduce' })

// P1.18 — admin-issued password-reset links, against the auth-backed project's server
// (CAPACITYLENS_AUTH=password on :8887 — see playwright.config.ts). Owner A signs up, bootstraps an
// org, invites member B (editor), then mints B a reset link from Settings → Members in the BROWSER
// (the write-once reset-link block). B — signed OUT, which is the whole point of a reset — opens the
// link, sets a new password, and signs in with it; the old password is asserted dead at the API
// layer. Browser-agnostic (no UA branching). Shared plumbing (API/PASSWORD/BOOTSTRAP_TOKEN/signUp)
// comes from ./auth-helpers.

const NEW_PASSWORD = 'fresh-password-456'
// Unique per run so reruns against a reused auth server don't collide on existing users/accounts.
const STAMP = Date.now()
const OWNER = `reset-owner-${STAMP}@capacitylens.dev`
const MEMBER = `reset-member-${STAMP}@capacitylens.dev`

test.describe('password reset link (CAPACITYLENS_AUTH=password)', () => {
  test('admin mints a reset link in Settings; the locked-out member sets a new password with it', async ({
    page,
    request,
  }) => {
    // ---- API setup: owner + org + member B joined as editor (invite consumed via the API). ----
    const ownerCookie = (await signUpUser(OWNER)).cookie
    const orgRes = await request.post(`${API}/api/orgs`, {
      headers: { cookie: ownerCookie, 'x-capacitylens-bootstrap-token': BOOTSTRAP_TOKEN },
      data: { name: `Reset Studio ${STAMP}` },
    })
    expect(orgRes.status()).toBe(201)
    const accountId = (await orgRes.json()).id as string

    const inviteRes = await request.post(`${API}/api/invites`, {
      headers: { cookie: ownerCookie },
      data: { accountId, role: 'editor' },
    })
    expect(inviteRes.status()).toBe(201)
    const inviteToken = (await inviteRes.json()).token as string

    const memberCookie = (await signUpUser(MEMBER)).cookie
    const joined = await request.post(`${API}/api/invites/${inviteToken}/accept`, {
      headers: { cookie: memberCookie },
    })
    expect(joined.status()).toBe(200)

    // ---- Browser, as the OWNER: mint the reset link from Settings → Members. ----
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await page.getByLabel('Email').fill(OWNER)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Pick the freshly-bootstrapped company, dismiss the first-entry intro (the members.auth idiom).
    await page.getByRole('button', { name: `Reset Studio ${STAMP}`, exact: true }).click()
    await page.getByTestId('intro-continue').click()

    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
    const memberRow = page.getByTestId('member-row').filter({ hasText: MEMBER })
    await expect(memberRow).toBeVisible()
    await memberRow.getByTestId('member-reset-password').click()

    // The write-once reset-link block: shown exactly once, straight from the create response.
    const linkEl = page.getByTestId('reset-link')
    await expect(linkEl).toContainText('/reset-password/')
    const resetLink = (await linkEl.textContent())?.trim() ?? ''

    // ---- Browser, signed OUT (fresh context state via a plain goto after clearing cookies):
    // the member opens the link WITHOUT a session — the page must render, not the login wall. ----
    await page.context().clearCookies()
    await page.goto(resetLink)
    await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible()
    await page.getByTestId('reset-new-password').fill(NEW_PASSWORD)
    await page.getByTestId('reset-confirm-password').fill(NEW_PASSWORD)
    await page.getByTestId('reset-submit').click()
    await expect(page.getByTestId('reset-success')).toBeVisible()

    // "Go to sign in" is a full page load that lands on the login wall; the NEW password works.
    await page.getByRole('link', { name: 'Go to sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await page.getByLabel('Email').fill(MEMBER)
    await page.getByLabel('Password').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    // Signed in with the NEW password: the member lands on their company picker, not the wall.
    await expect(page.getByRole('button', { name: `Reset Studio ${STAMP}`, exact: true })).toBeVisible()

    // ---- API-layer teeth: the OLD password is dead, and the token was single-use. ----
    const oldSignIn = await request.post(`${API}/api/auth/sign-in/email`, {
      data: { email: MEMBER, password: PASSWORD },
    })
    expect(oldSignIn.status()).toBe(401)

    const reuseToken = resetLink.split('/reset-password/')[1]
    const reuse = await request.post(`${API}/api/auth/reset-password`, {
      data: { newPassword: 'attacker-password-789', token: reuseToken },
    })
    expect(reuse.status()).toBe(400)
  })
})
