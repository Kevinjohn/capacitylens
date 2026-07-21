import { test, expect } from '@playwright/test'
import { openApp, selectShadOption } from './helpers'

// Covers US-SET-07. External / 3rd parties are a PER-ACCOUNT view pref (`externalEnabled` on the
// active Account, absent = false), DEFAULT OFF — hidden everywhere out of the box, but their data is
// untouched and returns when the switch goes on. They moved from a standalone /external tab INTO a
// gated **External** section under the Resources tab. The seed has one external party
// (r-ext-northstar, "Northstar Partners", booked on Visual Design) so the toggle is demonstrable.

// Turn the External feature on via Settings, then return to the Schedule. Used by the tests that
// exercise the band / assignee behaviour, which all need externals visible first.
async function enableExternal(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('link', { name: 'Settings' }).click()
  const toggle = page.getByRole('switch', { name: 'Show external resources' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false') // default off
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
}

test.describe('External / 3rd parties (per-account pref, default off)', () => {
  test('hidden by default: the seeded external is absent from the schedule and the Resources tab', async ({ page }) => {
    await openApp(page)
    // No External band on the schedule, no external lane.
    await expect(page.locator('[data-resource-id="r-ext-northstar"]')).toHaveCount(0)
    await expect(page.getByTestId('discipline-group').filter({ hasText: 'External / 3rd party' })).toHaveCount(0)

    // Resources page: no External section, no "Add external party" button.
    await page.getByRole('link', { name: 'Resources' }).click()
    await expect(page.getByRole('heading', { name: 'External', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add external party' })).toHaveCount(0)
    await expect(page.getByTestId('external-row')).toHaveCount(0)
  })

  test('the old /external URL redirects to the Resources tab', async ({ page }) => {
    // External no longer has its own tab — a saved bookmark must not 404; it redirects to /resources.
    await openApp(page, 'Studio North', '/external')
    await expect(page).toHaveURL(/\/resources$/)
    await expect(page.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible()
  })

  test('turning it on in Settings reveals the External section (with explainer) in the Resources tab and the band on the schedule', async ({ page }) => {
    await openApp(page)
    await enableExternal(page)

    // Settings section carries the explainer copy.
    await expect(page.getByText(/outside companies you hand work to but/i).first()).toBeVisible()

    // Resources page now shows the External section + its explainer + the seeded external.
    await page.getByRole('link', { name: 'Resources' }).click()
    await expect(page.getByRole('heading', { name: 'External', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add external party' })).toBeVisible()
    await expect(page.getByText(/never count toward your team’s capacity or utilisation/i)).toBeVisible()
    await expect(page.getByTestId('external-row').filter({ hasText: 'Northstar Partners' })).toBeVisible()
    // Externals are NOT mixed into the people rows.
    await expect(page.getByTestId('resource-row').filter({ hasText: 'Northstar Partners' })).toHaveCount(0)

    // Schedule now shows the neutral External band at the very bottom.
    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('radio', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight })
    await expect(page.getByTestId('discipline-group').last()).toContainText('External / 3rd party')
    const extBar = page.locator('[data-resource-id="r-ext-northstar"]').getByTestId('allocation-bar').filter({ hasText: 'Visual Design' })
    await expect(extBar).toBeVisible()
    await expect(extBar).not.toContainText('0h') // an external bar suppresses the hours figure
    // No per-row utilisation chip on the external row.
    await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Northstar Partners' }).getByTestId('utilization')).toHaveCount(0)
  })

  test('the choice survives navigation in the current demo session', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    await page.getByRole('switch', { name: 'Show external resources' }).click() // → on
    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('switch', { name: 'Show external resources' })).toHaveAttribute('aria-checked', 'true')
  })

  test('adds an external party in the Resources tab External section', async ({ page }) => {
    await openApp(page)
    await enableExternal(page)
    await page.getByRole('link', { name: 'Resources' }).click()

    await page.getByRole('button', { name: 'Add external party' }).click()
    await page.getByLabel('Company').fill('Pixel Forge')
    await page.getByLabel('Descriptor').fill('Print')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('external-row').filter({ hasText: 'Pixel Forge' })).toBeVisible()
    // Still not a person row.
    await expect(page.getByTestId('resource-row').filter({ hasText: 'Pixel Forge' })).toHaveCount(0)
  })

  test('assigns an activity from the row "+": the modal has no Hours field and saves a span-only bar', async ({ page }) => {
    await openApp(page)
    await enableExternal(page)
    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('radio', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight })

    await page.getByRole('button', { name: 'Add allocation for Northstar Partners' }).click()
    const dialog = page.getByRole('dialog', { name: 'New allocation' })
    await expect(dialog.getByRole('heading')).toContainText('Northstar Partners')
    // External work carries no load — the modal collects a date span only.
    await expect(dialog.getByLabel('Hours / day')).toHaveCount(0)
    // Externals have no working week — the weekend toggle is hidden too.
    await expect(dialog.getByText('Include weekends as working days')).toHaveCount(0)
    await expect(dialog.getByLabel('Start Date')).toBeVisible()

    await selectShadOption(dialog.getByLabel('Project', { exact: true }), 'p-acme')
    await selectShadOption(dialog.getByRole('combobox', { name: 'Activity', exact: true }), 't-wires') // Wireframes
    await page.getByRole('button', { name: 'Save' }).click()

    const newBar = page.locator('[data-resource-id="r-ext-northstar"]').getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })
    await expect(newBar).toBeVisible()
    await expect(newBar).not.toContainText('0h')
  })

  test('external parties are excluded from the Time off resource picker', async ({ page }) => {
    // Time off excludes externals unconditionally (no capacity), regardless of the view pref — but
    // enable the pref so the seeded external could otherwise be a candidate.
    await openApp(page)
    await enableExternal(page)
    await page.getByRole('link', { name: 'Time off' }).click()
    await page.getByRole('button', { name: 'Add time off' }).click()
    const resource = page.getByRole('dialog').getByLabel('Resource')
    await resource.click()
    await expect(page.getByRole('option', { name: 'Northstar Partners' })).toHaveCount(0)
    // Sanity: a real person IS offered.
    await expect(page.getByRole('option', { name: 'Tyler Nix' })).toBeVisible()
  })

  test('time-off draw mode is a no-op on an external lane (no orphan time-off)', async ({ page }) => {
    // Enable External first so the lane is visible (default off), then go to the schedule.
    await openApp(page)
    await enableExternal(page)
    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('radio', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => {
      ;(el as HTMLElement).scrollLeft = 0
      ;(el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight
    })
    // Switch the draw mode from Work to Time off (the toolbar toggle, not the nav link).
    await page.getByRole('radio', { name: 'Time off', exact: true }).click()
    // Draw a span on the empty far-left (back-buffer) of the external party's lane — a draw here on
    // a person's lane opens the time-off form; on an external it must be a no-op (no capacity).
    const lane = page.locator('[data-resource-id="r-ext-northstar"]')
    const b = await lane.boundingBox()
    if (!b) throw new Error('external lane not found')
    const y = b.y + b.height / 2
    await page.mouse.move(b.x + 6, y)
    await page.mouse.down()
    await page.mouse.move(b.x + 6 + 48 * 2, y, { steps: 8 })
    await page.mouse.up()
    // No time-off form opened and no time-off bar was drawn on the external lane.
    await expect(page.getByRole('dialog', { name: 'Add time off' })).toHaveCount(0)
    await expect(lane.getByTestId('timeoff-block')).toHaveCount(0)
  })

  // P2.5b: the per-row destructive action ARCHIVES (hidden from the active list, fully retained — NOT
  // a hard delete). Archiving is undoable via the local store.
  test('archiving an external party is undoable', async ({ page }) => {
    await openApp(page)
    await enableExternal(page)
    await page.getByRole('link', { name: 'Resources' }).click()

    await page.getByTestId('external-row').filter({ hasText: 'Northstar Partners' }).getByRole('button', { name: 'Archive Northstar Partners' }).click()
    await page.getByRole('alertdialog', { name: 'Archive resource?' }).getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(page.getByTestId('external-row').filter({ hasText: 'Northstar Partners' })).toHaveCount(0)

    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('external-row').filter({ hasText: 'Northstar Partners' })).toBeVisible()
  })
})
