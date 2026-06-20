import { test, expect, type Locator } from '@playwright/test'
import { openApp } from './helpers'

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

test.describe('Scheduler', () => {
  test('shows seeded resources, grouping and capacity cues', async ({ page }) => {
    await openApp(page)
    await expect(page.getByText('Tyler Nix')).toBeVisible()
    await expect(page.getByTestId('discipline-group').filter({ hasText: 'Design' })).toBeVisible()
    // Seed over-allocates Tyler on 3-4 June; weekends/time off are unavailable.
    await expect(page.getByTestId('over-marker').first()).toBeVisible()
    await expect(page.getByTestId('unavailable-day').first()).toBeVisible()
    await expect(page.getByTestId('utilization').first()).toBeVisible()
  })

  test('draws a new allocation on an empty part of a lane', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()

    const before = await page.getByTestId('allocation-bar').count()

    // reset horizontal scroll (scroll-to-today shifts the grid on mount)
    await page.getByTestId('scheduler-grid').evaluate((el) => {
      ;(el as HTMLElement).scrollLeft = 0
    })
    const lane = page.getByTestId('resource-lane').first()
    const b = await box(lane)
    const y = b.y + b.height / 2
    // The far-left of the lane (timeline origin) is empty for the first resource.
    await page.mouse.move(b.x + 6, y)
    await page.mouse.down()
    await page.mouse.move(b.x + 6 + 48 * 2, y, { steps: 8 })
    await page.mouse.up()

    await expect(page.getByRole('dialog', { name: 'New allocation' })).toBeVisible()
    await page.getByLabel('Project', { exact: true }).selectOption('p-acme')
    await page.getByLabel('Activity', { exact: true }).selectOption('t-wires')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByTestId('allocation-bar')).toHaveCount(before + 1)
  })

  test('drags a bar to move it later', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()

    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' })
    const b0 = await box(bar)
    const cx = b0.x + b0.width / 2
    const cy = b0.y + b0.height / 2

    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 60, cy, { steps: 8 }) // ~1 day right
    await page.mouse.up()

    const b1 = await box(bar)
    expect(b1.x).toBeGreaterThan(b0.x + 20)
  })

  test('resizes a bar via its end handle', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()

    // "Wireframes" (4 days) keeps its right edge on-screen, unlike the 9-day "Brand System".
    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })
    const b0 = await box(bar)
    const handle = bar.getByTestId('resize-end')
    const h = await box(handle)

    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await page.mouse.down()
    await page.mouse.move(h.x + h.width / 2 + 60, h.y + h.height / 2, { steps: 8 }) // extend ~1 day
    await page.mouse.up()

    const b1 = await box(bar)
    expect(b1.width).toBeGreaterThan(b0.width + 20)
  })

  test('zooming to more weeks shrinks the day columns (same bar gets narrower)', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()
    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' })

    await page.getByRole('button', { name: '1w', exact: true }).click()
    await expect(page.getByRole('button', { name: '1w', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '4w', exact: true })).toHaveAttribute('aria-pressed', 'false')
    const wide = await box(bar)
    await page.screenshot({ path: 'test-results/floaty-1week.png' })

    await page.getByRole('button', { name: '8w', exact: true }).click()
    await expect(page.getByRole('button', { name: '8w', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '1w', exact: true })).toHaveAttribute('aria-pressed', 'false')
    const narrow = await box(bar)
    await page.screenshot({ path: 'test-results/floaty-8week.png' })

    // Same 9-day allocation is physically narrower when more weeks are visible.
    expect(narrow.width).toBeLessThan(wide.width)
  })

  test('clicking Today re-centres the timeline after scrolling away', async ({ page }) => {
    await openApp(page)
    const grid = page.getByTestId('scheduler-grid')
    await expect(grid).toBeVisible()

    // Scroll far to the right, then ask to go back to Today.
    await grid.evaluate((el) => {
      ;(el as HTMLElement).scrollLeft = 5000
    })
    const scrolled = await grid.evaluate((el) => (el as HTMLElement).scrollLeft)
    expect(scrolled).toBeGreaterThan(800)

    await page.getByRole('button', { name: 'Today', exact: true }).click()

    // The grid re-scrolls back towards today (much smaller scrollLeft than where we were).
    await expect.poll(() => grid.evaluate((el) => (el as HTMLElement).scrollLeft)).toBeLessThan(scrolled - 400)
  })

  test('jumping to a date moves the timeline to that month', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()

    await page.getByLabel('Jump to date').fill('2026-08-10')
    await expect(page.getByLabel('Jump to date')).toHaveValue('2026-08-10')
    await expect(page.getByText('Aug 2026')).toBeVisible()
  })

  test('shows a detail popover on hover (US-SCH-15)', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    await page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' }).hover()
    const pop = page.getByTestId('allocation-popover')
    await expect(pop).toBeVisible()
    await expect(pop).toContainText('Brand Themes') // project name in the popover
  })

  test('shows overall and per-discipline utilisation summaries (US-SCH-14)', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('overall-utilization')).toContainText('%')
    await expect(page.getByTestId('discipline-group').first()).toContainText(/avg utilisation/)
  })

  test('stacks overlapping allocations onto a taller row (US-SCH-08)', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    // Tyler has two overlapping seed bars (3-4 June) -> 2 lanes; Nike has one -> 1 lane.
    const tylerBars = page.locator('[data-resource-id="r-tyler"]').getByTestId('allocation-bar')
    expect(await tylerBars.count()).toBe(2)
    const tylerRow = await page.getByTestId('scheduler-row').filter({ hasText: 'Tyler Nix' }).boundingBox()
    const nikeRow = await page.getByTestId('scheduler-row').filter({ hasText: 'Nike Spiros' }).boundingBox()
    expect(tylerRow!.height).toBeGreaterThan(nikeRow!.height) // stacked -> taller
  })

  test('marks today with a vertical line when in range (US-SCH-12)', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('today-line').first()).toBeVisible()
  })

  test('allocation status and note are visually distinct on the bar (US-SCH-19)', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })

    // Seed: Tyler's Visual Design bar is tentative (the placeholder also has a confirmed one).
    await expect(
      page.locator('[data-resource-id="r-tyler"]').getByTestId('allocation-bar').filter({ hasText: 'Visual Design' }),
    ).toHaveAttribute('data-status', 'tentative')

    // Mark Wireframes completed + add a note -> ✓ prefix and • marker.
    await page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit allocation' })
    await dialog.getByLabel('Status').selectOption({ label: 'Completed' })
    await dialog.getByLabel('Note').fill('Handed off to QA')
    await page.getByRole('button', { name: 'Save' }).click()

    const done = page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })
    await expect(done).toHaveAttribute('data-status', 'completed')
    await expect(done).toContainText('✓')
    await expect(done).toContainText('•')
  })
})
