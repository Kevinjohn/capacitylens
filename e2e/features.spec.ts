import { test, expect, type Locator } from '@playwright/test'
import { openApp } from './helpers'

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

test.describe('Feature flows', () => {
  test('filtering by project narrows the schedule to that project', async ({ page }) => {
    await openApp(page)
    const bars = page.getByTestId('allocation-bar')
    expect(await bars.count()).toBeGreaterThan(1)

    await page.getByLabel('Filter by project').selectOption('p-brand')
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' })).toBeVisible()

    // Filtering hides non-matching resources by default, collapsing the schedule to
    // just the project's work ("Show unallocated" opts the dimmed staffing view in).
    await expect(bars).toHaveCount(1)
  })

  test('undo restores a deleted allocation', async ({ page }) => {
    await openApp(page)
    const bars = page.getByTestId('allocation-bar')
    const n = await bars.count()

    await bars.filter({ hasText: 'Brand System' }).click()
    await expect(page.getByRole('dialog', { name: 'Edit allocation' })).toBeVisible()
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(bars).toHaveCount(n - 1)

    // Undo here uses the global ⌘Z shortcut (AppShell); the toolbar Undo button path is
    // covered in toolbar.spec.ts. Click an empty corner of the grid first so the shortcut
    // isn't swallowed by a focused input.
    await page.getByTestId('scheduler-grid').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Meta+z')
    await expect(bars).toHaveCount(n)
  })

  test('booking time off greys the schedule', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()
    const blocksBefore = await page.getByTestId('timeoff-block').count()

    await page.getByRole('link', { name: 'Time off' }).click()
    await page.getByRole('button', { name: 'Add time off' }).click()
    await page.getByLabel('Resource').selectOption({ label: 'Nike Spiros' })
    await page.getByLabel('Start').fill('2026-06-18')
    await page.getByLabel('End').fill('2026-06-20')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('timeoff-row')).toHaveCount(2) // seed Tyler + new Nike

    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()
    await expect.poll(() => page.getByTestId('timeoff-block').count()).toBeGreaterThan(blocksBefore)
  })

  test('clicking a discipline header collapses its rows', async ({ page }) => {
    await openApp(page)
    await expect(page.getByText('Tyler Nix')).toBeVisible()
    await page.getByRole('button', { name: 'Design', exact: true }).click()
    await expect(page.getByText('Tyler Nix')).toHaveCount(0) // rows removed
    await expect(page.getByTestId('discipline-group').first()).toBeVisible() // header stays
    await page.screenshot({ path: 'test-results/floaty-collapsed.png' })
  })

  test('dragging an allocation onto another row reassigns it', async ({ page }) => {
    await openApp(page)
    // Zoom keeps the left-edge date anchored (the frozen "today"'s Monday), so the
    // early-June seed bars stay in view — no manual scroll reset needed.
    await page.getByRole('button', { name: '4w', exact: true }).click()

    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' })
    const b0 = await box(bar)
    // Address the target row by identity, not position — robust to seed re-ordering.
    const nikeLane = page.locator('[data-resource-id="r-nike"]')
    const nike = await box(nikeLane)
    const cx = b0.x + b0.width / 2

    await page.mouse.move(cx, b0.y + b0.height / 2)
    await page.mouse.down()
    await page.mouse.move(cx, nike.y + nike.height / 2, { steps: 10 })
    // Nike's row is highlighted as the drop target mid-drag.
    await expect(nikeLane).toHaveAttribute('data-droptarget', '')
    await page.screenshot({ path: 'test-results/floaty-drophighlight.png' })
    await page.mouse.up()

    // Assert the resulting state, not a pixel delta: the bar now lives inside Nike's lane.
    await expect(nikeLane.getByTestId('allocation-bar').filter({ hasText: 'Brand System' })).toBeVisible()
    // Highlight cleared after drop.
    await expect(nikeLane).not.toHaveAttribute('data-droptarget', '')
  })

  test('drawing in Time off mode opens a prefilled time-off form', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()
    // Toolbar draw-mode toggle (a button — distinct from the "Time off" nav link).
    await page.getByRole('button', { name: 'Time off', exact: true }).click()

    const lane = page.locator('[data-resource-id="r-nike"]')
    const b = await box(lane)
    const y = b.y + b.height / 2
    // Draw on EMPTY lane space, just right of Nike's seeded allocation. A gesture
    // started on the bar drags/resizes it (the bar stops propagation) instead of
    // drawing — anchor to the bar's measured box so this is robust to zoom/origin.
    const seededBar = await box(lane.getByTestId('allocation-bar'))
    const x0 = seededBar.x + seededBar.width + 20
    await page.mouse.move(x0, y)
    await page.mouse.down()
    await page.mouse.move(x0 + 72, y, { steps: 6 })
    await page.mouse.up()

    // Opens the time-off form (not the allocation modal), prefilled with the row's resource.
    const dialog = page.getByRole('dialog', { name: 'Add time off' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Resource')).toHaveValue('r-nike')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog', { name: 'Add time off' })).toHaveCount(0)
  })

  test('drawing on a placeholder locks the modal to its bound project', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    // Placeholders are hidden by default (device-global pref) — enable them so the lane renders.
    await page.getByRole('switch', { name: 'Show placeholders' }).click()
    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => {
      ;(el as HTMLElement).scrollLeft = 0
    })

    // The seeded placeholder is bound to p-acme — select it by id, not position.
    const lane = page.locator('[data-resource-id="r-ph-designer"]')
    const b = await box(lane)
    const y = b.y + b.height / 2
    // A short left-to-right draw near the lane origin (distance isn't load-bearing — it just opens the create modal).
    await page.mouse.move(b.x + 8, y)
    await page.mouse.down()
    await page.mouse.move(b.x + 48, y, { steps: 6 })
    await page.mouse.up()

    await expect(page.getByRole('dialog', { name: 'New allocation' })).toBeVisible()
    const project = page.getByLabel('Project', { exact: true })
    // "Locked" = the bound project is preselected and the choices are restricted to it
    // (+ the general option), but the select stays ENABLED so the placeholder can still
    // take general activities. A non-bound project ("Brand Themes") is not offered.
    await expect(project).toHaveValue('p-acme')
    await expect(project).toBeEnabled()
    await expect(project.getByRole('option', { name: /Brand Themes/ })).toHaveCount(0)
  })
})
