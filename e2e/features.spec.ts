import { test, expect, type Locator } from '@playwright/test'

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

test.describe('Feature flows', () => {
  test('filtering by project narrows the schedule to that project', async ({ page }) => {
    await page.goto('/')
    const bars = page.getByTestId('allocation-bar')
    expect(await bars.count()).toBeGreaterThan(1)

    await page.getByLabel('Filter by project').selectOption('p-brand')

    await expect(bars).toHaveCount(1)
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' })).toBeVisible()
  })

  test('undo restores a deleted allocation', async ({ page }) => {
    await page.goto('/')
    const bars = page.getByTestId('allocation-bar')
    const n = await bars.count()

    await bars.filter({ hasText: 'Brand System' }).click()
    await expect(page.getByRole('dialog', { name: 'Edit allocation' })).toBeVisible()
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(bars).toHaveCount(n - 1)

    await page.getByTitle('Undo (⌘Z)').click()
    await expect(bars).toHaveCount(n)
  })

  test('booking time off greys the schedule', async ({ page }) => {
    await page.goto('/')
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
    await page.goto('/')
    await expect(page.getByText('Tyler Nix')).toBeVisible()
    await page.getByRole('button', { name: 'Design', exact: true }).click()
    await expect(page.getByText('Tyler Nix')).toHaveCount(0) // rows removed
    await expect(page.getByTestId('discipline-group').first()).toBeVisible() // header stays
    await page.screenshot({ path: 'test-results/floaty-collapsed.png' })
  })

  test('dragging an allocation onto another row reassigns it', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => {
      ;(el as HTMLElement).scrollLeft = 0
    })

    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' })
    const b0 = await box(bar)
    // Resource lanes in order: Tyler, Senior Designer, Nike (index 2), Alex, Pam.
    const nike = await box(page.getByTestId('resource-lane').nth(2))
    const cx = b0.x + b0.width / 2

    await page.mouse.move(cx, b0.y + b0.height / 2)
    await page.mouse.down()
    await page.mouse.move(cx, nike.y + nike.height / 2, { steps: 10 })
    // Nike's row is highlighted as the drop target mid-drag.
    await expect(page.getByTestId('resource-lane').nth(2)).toHaveAttribute('data-droptarget', '')
    await page.screenshot({ path: 'test-results/floaty-drophighlight.png' })
    await page.mouse.up()

    const b1 = await box(bar)
    expect(b1.y).toBeLessThan(b0.y - 30) // moved up into Nike's row
    // Highlight cleared after drop.
    await expect(page.getByTestId('resource-lane').nth(2)).not.toHaveAttribute('data-droptarget', '')
  })

  test('drawing on a placeholder locks the modal to its bound project', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => {
      ;(el as HTMLElement).scrollLeft = 0
    })

    // 2nd lane in the Design group is the "Senior Designer" placeholder (bound to p-acme).
    const lane = page.getByTestId('resource-lane').nth(1)
    const b = await box(lane)
    const y = b.y + b.height / 2
    await page.mouse.move(b.x + 6, y)
    await page.mouse.down()
    await page.mouse.move(b.x + 6 + 48, y, { steps: 6 })
    await page.mouse.up()

    await expect(page.getByRole('dialog', { name: 'New allocation' })).toBeVisible()
    const project = page.getByLabel('Project', { exact: true })
    await expect(project).toBeDisabled()
    await expect(project).toHaveValue('p-acme')
  })
})
