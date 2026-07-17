import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// The account-level "Use disciplines" toggle (Settings → Disciplines). Off should hide
// disciplines across the whole app and render the schedule flat; on restores them.
test.describe('Disciplines optional (account-level)', () => {
  test('turning disciplines off hides every surface; turning it back on restores them', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')

    // Enable External (default off) so its band is present to prove the "external still segregates
    // in flat mode" exception below; it's an independent per-account pref.
    await page.getByRole('switch', { name: 'Show external resources' }).click()

    // On by default for the seed: the nav link is present and the switch reads on.
    await expect(page.getByRole('link', { name: 'Disciplines' })).toBeVisible()
    const useDisciplines = page.getByRole('switch', { name: 'Use disciplines' })
    await expect(useDisciplines).toHaveAttribute('aria-checked', 'true')

    // Turn it off.
    await useDisciplines.click()
    await expect(useDisciplines).toHaveAttribute('aria-checked', 'false')

    // Sidebar nav link is gone.
    await expect(page.getByRole('link', { name: 'Disciplines' })).toHaveCount(0)

    // …and the collapsed icon rail (the "mobile menu") drops it too: 8 icons, no Disciplines
    // (External is no longer a standalone nav link — it lives inside the Resources tab now).
    await page.getByRole('button', { name: 'Collapse menu' }).click()
    await expect(page.getByTestId('nav-rail-item')).toHaveCount(8)
    await expect(page.locator('[data-testid="nav-rail-item"][data-label="Disciplines"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Expand menu' }).click()

    // Schedule renders flat: the rows are still there, but there are no discipline-group
    // bands and the discipline filter control is hidden.
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Tyler Nix' })).toBeVisible()
    // The External band is the LAST item; scroll to the bottom so it's inside the virtualised
    // window before asserting (the grid drops off-screen rows from the DOM).
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight })
    // Our people render flat — no Design/Development bands. The External band is the ONE
    // exception: it always keeps its header so outsourced work stays segregated, disciplines
    // on or off (the seeded "Northstar Partners" makes the band present here).
    await expect(page.getByTestId('discipline-group')).toHaveCount(1)
    await expect(page.getByTestId('discipline-group')).toContainText('External / 3rd party')
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

    // The off state guards /disciplines for this demo session. Navigate without reloading: the
    // public demo is intentionally in-memory, so a fresh document would reset the seed instead of
    // proving the route guard against the state changed above.
    await page.evaluate(() => {
      window.history.pushState({}, '', '/disciplines')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
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
