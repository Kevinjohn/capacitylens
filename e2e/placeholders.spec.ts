import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-SET-06. Placeholders are a PER-ACCOUNT view pref (`placeholdersEnabled` on the active
// Account, absent = false), DEFAULT OFF — hidden everywhere out of the box, but their data is
// untouched and returns when the switch goes on. The seed has one placeholder (r-ph-designer,
// role "Senior Designer", bound to Project Lightning) so the toggle is demonstrable.
test.describe('Placeholders (per-account pref, default off)', () => {
  test('hidden by default: the seeded placeholder is absent from the schedule and Resources list', async ({ page }) => {
    await openApp(page)
    // No placeholder lane on the schedule (real people only — both Placeholders AND External are
    // per-account prefs that default OFF, so neither band shows out of the box).
    await expect(page.locator('[data-resource-id="r-ph-designer"]')).toHaveCount(0)
    await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Placeholder' })).toHaveCount(0)

    // Resources page: no Placeholders section, no "Add placeholder" button.
    await page.getByRole('link', { name: 'Resources' }).click()
    await expect(page.getByRole('heading', { name: 'Placeholders' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add placeholder' })).toHaveCount(0)
  })

  test('turning it on in Settings reveals the placeholder with a "?" avatar and "Placeholder" name', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    const toggle = page.getByRole('switch', { name: 'Show placeholders' })
    await expect(toggle).toHaveAttribute('aria-checked', 'false') // default off
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')

    // Resources page now shows the Placeholders section + the seeded placeholder ("Placeholder",
    // role "Senior Designer" in the secondary text).
    await page.getByRole('link', { name: 'Resources' }).click()
    await expect(page.getByRole('heading', { name: 'Placeholders' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add placeholder' })).toBeVisible()
    const phRow = page.getByTestId('resource-row').filter({ hasText: 'Senior Designer' })
    await expect(phRow.getByText('Placeholder', { exact: true })).toBeVisible()

    // Schedule now shows the placeholder lane. The name + "?" avatar live in the row HEADER (the
    // left sticky column), a sibling of the [data-resource-id] gridcell — so scope to the whole
    // scheduler-row that contains this placeholder's lane, then assert the header content.
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.locator('[data-resource-id="r-ph-designer"]')).toBeVisible()
    const phScheduleRow = page
      .getByTestId('scheduler-row')
      .filter({ has: page.locator('[data-resource-id="r-ph-designer"]') })
    const header = phScheduleRow.getByRole('rowheader')
    await expect(header.getByText('Placeholder', { exact: true })).toBeVisible() // literal name
    await expect(header.getByText('?', { exact: true })).toBeVisible() // question-mark avatar
  })

  test('the choice survives a reload (per-account pref)', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    await page.getByRole('switch', { name: 'Show placeholders' }).click() // → on
    await page.reload()
    // Re-pick the company after reload (activeAccountId is never persisted) and re-open Settings.
    await page.getByRole('button', { name: 'Studio North', exact: true }).click()
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('switch', { name: 'Show placeholders' })).toHaveAttribute('aria-checked', 'true')
  })
})
