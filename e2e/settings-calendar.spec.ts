import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { openApp } from './helpers'

test.use({ reducedMotion: 'reduce' })

// P1.14 inverted this contract: week-start and time zone used to be EDITABLE in Settings; they are
// now CAPTURED at company creation and FROZEN thereafter (the server returns 409 on a change). These
// tests assert the now-frozen behaviour — the controls render their chosen values but are disabled —
// so the coverage is preserved, not deleted. (The create-company capture is in onboarding.spec.ts;
// the server 409 in onboarding.db.spec.ts.)
test.describe('Calendar settings (frozen after creation)', () => {
  test('week-start and timezone render the chosen values but are disabled', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')

    // The seeded company starts Monday / GMT — the values still SHOW.
    const mondayBtn = page.getByRole('radio', { name: 'Monday' })
    const sundayBtn = page.getByRole('radio', { name: 'Sunday' })
    await expect(mondayBtn).toHaveAttribute('aria-checked', 'true')
    await expect(sundayBtn).toHaveAttribute('aria-checked', 'false')
    const tzSelect = page.getByLabel('Timezone')
    await expect(tzSelect).toHaveText('GMT (UTC+00:00)')

    // …but every control is disabled (the freeze).
    await expect(mondayBtn).toBeDisabled()
    await expect(sundayBtn).toBeDisabled()
    await expect(tzSelect).toBeDisabled()

    // A read-only Language row + the explainer make the freeze legible.
    await expect(page.getByTestId('settings-language')).toHaveText('English')
    await expect(page.getByText(/Set when the company was created and can't be changed/i)).toBeVisible()
  })

  test('clicking a disabled week-start segment cannot change the selection', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    const mondayBtn = page.getByRole('radio', { name: 'Monday' })
    const sundayBtn = page.getByRole('radio', { name: 'Sunday' })
    // force past the disabled-pointer guard; the value must still not move.
    await sundayBtn.click({ force: true })
    await expect(mondayBtn).toHaveAttribute('aria-checked', 'true')
    await expect(sundayBtn).toHaveAttribute('aria-checked', 'false')
  })

  test('Settings page passes axe accessibility check', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    const results = await new AxeBuilder({ page }).analyze()
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(
      blocking,
      JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2),
    ).toEqual([])
  })
})
