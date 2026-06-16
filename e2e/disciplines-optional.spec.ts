import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// The account-level "Use disciplines" toggle (Settings → Disciplines). Off should hide
// disciplines across the whole app and render the schedule flat; on restores them.
test.describe('Disciplines optional (account-level)', () => {
  test('turning disciplines off hides every surface; turning it back on restores them', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')

    // On by default for the seed: the nav link is present and the switch reads on.
    await expect(page.getByRole('link', { name: 'Disciplines' })).toBeVisible()
    const useDisciplines = page.getByRole('switch', { name: 'Use disciplines' })
    await expect(useDisciplines).toHaveAttribute('aria-checked', 'true')

    // Turn it off.
    await useDisciplines.click()
    await expect(useDisciplines).toHaveAttribute('aria-checked', 'false')

    // Sidebar nav link is gone.
    await expect(page.getByRole('link', { name: 'Disciplines' })).toHaveCount(0)

    // …and the collapsed icon rail (the "mobile menu") drops it too: 7 icons, no Disciplines.
    await page.getByRole('button', { name: 'Collapse menu' }).click()
    await expect(page.getByTestId('nav-rail-item')).toHaveCount(7)
    await expect(page.locator('[data-testid="nav-rail-item"][title="Disciplines"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Expand menu' }).click()

    // Schedule renders flat: the rows are still there, but there are no discipline-group
    // bands and the discipline filter control is hidden.
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Tyler Nix' })).toBeVisible()
    await expect(page.getByTestId('discipline-group')).toHaveCount(0)
    await expect(page.getByLabel('Filter by discipline')).toHaveCount(0)

    // The command palette no longer offers the Disciplines page.
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByTestId('command-palette')).toBeVisible()
    await expect(page.getByTestId('command-palette-option').filter({ hasText: 'Disciplines' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // The resource form drops the Discipline field.
    await page.getByRole('link', { name: 'Resources' }).click()
    await page.getByRole('button', { name: 'Add resource' }).click()
    await expect(page.getByLabel('Discipline')).toHaveCount(0)
    await page.getByRole('button', { name: 'Cancel' }).click()

    // The off state persists on the account, so a direct /disciplines URL is guarded:
    // re-entering the app there redirects to the schedule.
    await openApp(page, 'Studio North', '/disciplines')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()

    // Turn it back on — the nav link returns and the schedule regroups into discipline bands.
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('switch', { name: 'Use disciplines' }).click()
    await expect(page.getByRole('link', { name: 'Disciplines' })).toBeVisible()
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByTestId('discipline-group').first()).toBeVisible()
  })
})
