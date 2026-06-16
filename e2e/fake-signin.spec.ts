import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.use({ reducedMotion: 'reduce' })

// US-NAV-11: a COSMETIC demo "fake sign-in" gate shown before the company picker in the
// default (auth-off) deploy, to preview the intended "log in first, then pick a company"
// flow. There is NO real authentication and no popup — clicking just advances. The auth-ON
// deploy (the real login wall) is covered by login.auth.spec.ts, where this demo gate stays
// dormant (AppShell only mounts it when authMode === 'off').

const FIXED_NOW = new Date('2026-06-03T12:00:00')

test.describe('fake sign-in (cosmetic demo gate)', () => {
  test('precedes the company picker; signing in reveals it, then the app', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await page.goto('/')

    // The demo sign-in is the first screen — the picker is walled off behind it.
    await expect(page.getByRole('heading', { name: 'Choose an account' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Choose a company' })).toHaveCount(0)

    // No popup, no password: clicking the account advances to the picker.
    await page.getByTestId('fake-sign-in').click()
    await expect(page.getByRole('heading', { name: 'Choose a company' })).toBeVisible()
    await expect(page.getByText('Signed in as Jordan Avery')).toBeVisible()

    // Pick a company → the app.
    await page.getByRole('button', { name: 'Studio North', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Schedule' })).toBeVisible()
  })

  test('staying signed in persists across reload; Sign out returns to the demo sign-in', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await page.goto('/')
    await page.getByTestId('fake-sign-in').click()
    await expect(page.getByRole('heading', { name: 'Choose a company' })).toBeVisible()

    // The sign-in persists (device-global): a reload lands straight on the picker.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Choose a company' })).toBeVisible()
    await expect(page.getByTestId('fake-sign-in')).toHaveCount(0)

    // Sign out from the picker → back behind the demo sign-in, and it sticks on reload.
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Choose an account' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Choose an account' })).toBeVisible()
  })

  test('has no serious or critical accessibility violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Choose an account' })).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(
      blocking,
      JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2),
    ).toEqual([])
  })
})
