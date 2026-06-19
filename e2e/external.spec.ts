import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// External / 3rd-party resources: managed on their own tab (out of Resources), assignable to any
// task with NO hours, and shown in a neutral band at the bottom of the schedule with no
// utilisation / over-markers. "Dog Eat Cog" is seeded in Studio North (see seed.ts).
test.describe('External / 3rd parties', () => {
  test('adds an external party on its own tab; it does NOT appear on the Resources tab', async ({ page }) => {
    await openApp(page, 'Studio North', '/external')
    await expect(page.getByTestId('external-row').filter({ hasText: 'Dog Eat Cog' })).toBeVisible()

    await page.getByRole('button', { name: 'Add external party' }).click()
    await page.getByLabel('Company').fill('Pixel Forge')
    await page.getByLabel('Descriptor').fill('Print')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('external-row').filter({ hasText: 'Pixel Forge' })).toBeVisible()

    // The Resources tab is for our own people/placeholders — externals must not leak into it.
    await page.getByRole('link', { name: 'Resources' }).click()
    await expect(page.getByTestId('resource-row').filter({ hasText: 'Pixel Forge' })).toHaveCount(0)
    await expect(page.getByTestId('resource-row').filter({ hasText: 'Dog Eat Cog' })).toHaveCount(0)
  })

  test('renders in a band at the very bottom of the schedule, with a bar that shows no hours', async ({ page }) => {
    await openApp(page, 'Studio North')
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    // Scroll to the bottom so the trailing external band is inside the virtualised window.
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight })

    // The external band is the LAST group header, titled "External / 3rd party".
    await expect(page.getByTestId('discipline-group').last()).toContainText('External / 3rd party')

    // Its seeded booking (Visual Design) renders, but with NO hours figure (a person's bar shows
    // "· Nh"; an external's is suppressed — it would have read "· 0h").
    const extBar = page.locator('[data-resource-id="r-ext-dogeatcog"]').getByTestId('allocation-bar').filter({ hasText: 'Visual Design' })
    await expect(extBar).toBeVisible()
    await expect(extBar).not.toContainText('0h')

    // No per-row utilisation chip on the external row.
    await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Dog Eat Cog' }).getByTestId('utilization')).toHaveCount(0)
  })

  test('assigns a task from the row "+": the modal has no Hours field and saves a span-only bar', async ({ page }) => {
    await openApp(page, 'Studio North')
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })

    await page.getByRole('button', { name: 'Add allocation for Dog Eat Cog' }).click()
    const dialog = page.getByRole('dialog', { name: 'New allocation' })
    await expect(dialog.getByRole('heading')).toContainText('Dog Eat Cog')
    // External work carries no load — the modal collects a date span only.
    await expect(dialog.getByLabel('Hours / day')).toHaveCount(0)
    // Externals have no working week — the weekend toggle is hidden too.
    await expect(dialog.getByText('Include weekends as working days')).toHaveCount(0)
    await expect(dialog.getByLabel('Start Date')).toBeVisible()

    await dialog.getByLabel('Project', { exact: true }).selectOption('p-acme')
    await dialog.getByLabel('Task', { exact: true }).selectOption('t-wires') // Wireframes
    await page.getByRole('button', { name: 'Save' }).click()

    const newBar = page.locator('[data-resource-id="r-ext-dogeatcog"]').getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })
    await expect(newBar).toBeVisible()
    await expect(newBar).not.toContainText('0h')
  })

  test('external parties are excluded from the Time off resource picker', async ({ page }) => {
    await openApp(page, 'Studio North', '/timeoff')
    await page.getByRole('button', { name: 'Add time off' }).click()
    const resource = page.getByRole('dialog').getByLabel('Resource')
    await expect(resource.getByRole('option', { name: 'Dog Eat Cog' })).toHaveCount(0)
    // Sanity: a real person IS offered.
    await expect(resource.getByRole('option', { name: 'Tyler Nix' })).toBeAttached()
  })

  test('time-off draw mode is a no-op on an external lane (no orphan time-off)', async ({ page }) => {
    await openApp(page, 'Studio North')
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => {
      ;(el as HTMLElement).scrollLeft = 0
      ;(el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight
    })
    // Switch the draw mode from Work to Time off (the toolbar toggle, not the nav link).
    await page.getByRole('button', { name: 'Time off', exact: true }).click()
    // Draw a span on the empty far-left (back-buffer) of the external party's lane — a draw here on
    // a person's lane opens the time-off form; on an external it must be a no-op (no capacity).
    const lane = page.locator('[data-resource-id="r-ext-dogeatcog"]')
    const b = await lane.boundingBox()
    if (!b) throw new Error('external lane not found')
    const y = b.y + b.height / 2
    await page.mouse.move(b.x + 6, y)
    await page.mouse.down()
    await page.mouse.move(b.x + 6 + 48 * 2, y, { steps: 8 })
    await page.mouse.up()
    await expect(page.getByRole('dialog', { name: 'Add time off' })).toHaveCount(0)
  })

  test('deleting an external party is undoable', async ({ page }) => {
    await openApp(page, 'Studio North', '/external')
    await page.getByTestId('external-row').filter({ hasText: 'Dog Eat Cog' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('external-row').filter({ hasText: 'Dog Eat Cog' })).toHaveCount(0)

    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('external-row').filter({ hasText: 'Dog Eat Cog' })).toBeVisible()
  })
})
