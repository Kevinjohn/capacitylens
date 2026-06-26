import { test, expect } from '@playwright/test'

test.use({ reducedMotion: 'reduce' })

// Onboarding capture (P1.14): the create-company form captures week-start, time zone and language
// (the three fields the server FREEZES after creation), then lands in the app; Settings shows those
// three controls DISABLED. Runs in the default OFF/localStorage build (the create flow is identical
// to server mode — it routes through the same addAccount).
const FIXED_NOW = new Date('2026-06-03T12:00:00')

test.describe('onboarding: capture-then-freeze language / week-start / time zone', () => {
  test('create a company capturing week-start + timezone → land in app → Settings shows them disabled', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW)
    await page.goto('/')

    // Clear through the cosmetic demo sign-in gate if it's up (default OFF deploy).
    const signIn = page.getByTestId('fake-sign-in')
    const newCompany = page.getByRole('button', { name: 'New company' })
    await signIn.or(newCompany).first().waitFor()
    if (await signIn.isVisible()) await signIn.click()

    // Open the create-company form.
    await newCompany.click()

    // The three frozen-after-creation fields are present with concrete defaults.
    await expect(page.getByRole('radio', { name: 'Monday' })).toHaveAttribute('aria-checked', 'true')
    const tz = page.getByLabel('Timezone')
    await expect(tz).toHaveValue('Etc/GMT')
    await expect(page.getByTestId('create-language')).toHaveText('English')

    // Capture a non-default week-start and time zone, then create.
    await page.getByRole('radio', { name: 'Sunday' }).click()
    await tz.selectOption('Europe/London')
    await page.getByLabel('Company name').fill('Onboarded Co')
    await page.getByRole('button', { name: 'Create company' }).click()

    // Creating activates the company → land in the app (a post-create intro may precede it).
    const introContinue = page.getByTestId('intro-continue')
    const appMain = page.locator('#main')
    await introContinue.or(appMain).first().waitFor()
    if (await introContinue.isVisible()) await introContinue.click()
    await expect(appMain).toBeVisible()

    // Navigate to Settings via the in-app nav (a full reload would drop the never-persisted
    // active account and bounce back to the picker). Settings shows the captured values, now FROZEN.
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('radio', { name: 'Sunday' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('radio', { name: 'Sunday' })).toBeDisabled()
    await expect(page.getByRole('radio', { name: 'Monday' })).toBeDisabled()
    await expect(page.getByLabel('Timezone')).toBeDisabled()
    await expect(page.getByLabel('Timezone')).toHaveValue('Europe/London')
    await expect(page.getByTestId('settings-language')).toHaveText('English')
    await expect(page.getByText(/Set when the company was created and can't be changed/i)).toBeVisible()
  })
})
