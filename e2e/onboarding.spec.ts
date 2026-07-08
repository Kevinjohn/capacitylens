import { test, expect } from '@playwright/test'
import { openNewCompanyForm, createCompany } from './helpers'

test.use({ reducedMotion: 'reduce' })

// Onboarding capture (P1.14): the create-company form captures week-start, time zone and language
// (the three fields the server FREEZES after creation), then lands in the app; Settings shows those
// three controls DISABLED. Runs in the default OFF/localStorage build (the create flow is identical
// to server mode — it routes through the same addAccount).

test.describe('onboarding: capture-then-freeze language / week-start / time zone', () => {
  test('create a company capturing week-start + timezone → land in app → Settings shows them disabled', async ({ page }) => {
    // Same frozen-clock + fake-sign-in + "New company" walk as helpers.ts's `openApp`/
    // `openNewCompany`, stopping short so this spec can inspect and change the open form's
    // fields before submitting it.
    await openNewCompanyForm(page)

    // The three frozen-after-creation fields are present with concrete defaults.
    await expect(page.getByRole('radio', { name: 'Monday' })).toHaveAttribute('aria-checked', 'true')
    const tz = page.getByLabel('Timezone')
    await expect(tz).toHaveValue('Etc/GMT')
    await expect(page.getByTestId('create-language')).toHaveText('English')

    // Capture a non-default week-start and time zone, then create.
    await page.getByRole('radio', { name: 'Sunday' }).click()
    await tz.selectOption('Europe/London')
    await createCompany(page, 'Onboarded Co')

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
