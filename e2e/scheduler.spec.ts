import { test, expect, type Locator } from '@playwright/test'

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

test.describe('Scheduler', () => {
  test('shows seeded resources, grouping and capacity cues', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Tyler Nix')).toBeVisible()
    await expect(page.getByTestId('discipline-group').filter({ hasText: 'Design' })).toBeVisible()
    // Seed over-allocates Tyler on 3-4 June; weekends/time off are unavailable.
    await expect(page.getByTestId('over-marker').first()).toBeVisible()
    await expect(page.getByTestId('unavailable-day').first()).toBeVisible()
    await expect(page.getByTestId('utilization').first()).toBeVisible()
  })

  test('draws a new allocation on an empty part of a lane', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Day', exact: true }).click()

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
    await page.getByLabel('Task', { exact: true }).selectOption('t-wires')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByTestId('allocation-bar')).toHaveCount(before + 1)
  })

  test('drags a bar to move it later', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Day', exact: true }).click()

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
    await page.goto('/')
    await page.getByRole('button', { name: 'Day', exact: true }).click()

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
})
