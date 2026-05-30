import { test, expect, type Locator } from '@playwright/test'
import { openApp } from './helpers'

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

// Covers US-TBR-01..07.
test.describe('Toolbar', () => {
  test('zooms the timeline and tracks the active level', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '8w', exact: true }).click()
    await expect(page.getByRole('button', { name: '8w', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '1w', exact: true })).toHaveAttribute('aria-pressed', 'false')
  })

  test('pans the window a week with Prev and Next', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' })
    const b0 = await box(bar)

    // Panning forward moves the origin later, so a fixed-date bar shifts left.
    await page.getByRole('button', { name: 'Next' }).click()
    const b1 = await box(bar)
    expect(b1.x).toBeLessThan(b0.x)

    // Prev brings it back to the right.
    await page.getByRole('button', { name: 'Prev' }).click()
    const b2 = await box(bar)
    expect(b2.x).toBeGreaterThan(b1.x)
  })

  test('re-centres on Today after scrolling away', async ({ page }) => {
    await openApp(page)
    const grid = page.getByTestId('scheduler-grid')
    await grid.evaluate((el) => { (el as HTMLElement).scrollLeft = 5000 })
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await expect.poll(() => grid.evaluate((el) => (el as HTMLElement).scrollLeft)).toBeLessThan(4000)
  })

  test('jumps to a chosen date', async ({ page }) => {
    await openApp(page)
    await page.getByLabel('Jump to date').fill('2026-09-10')
    await expect(page.getByText('Sep 2026')).toBeVisible()
  })

  test('switches draw mode between Work and Time off', async ({ page }) => {
    await openApp(page)
    const work = page.getByRole('button', { name: 'Work', exact: true })
    const timeoff = page.getByRole('button', { name: 'Time off', exact: true })
    await expect(work).toHaveAttribute('aria-pressed', 'true')
    await timeoff.click()
    await expect(timeoff).toHaveAttribute('aria-pressed', 'true')
    await expect(work).toHaveAttribute('aria-pressed', 'false')
  })

  test('undoes and redoes an edit with the toolbar buttons and disables at the ends', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled() // nothing yet

    const before = await page.getByTestId('allocation-bar').count()
    await page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' }).click()
    await page.getByRole('dialog', { name: 'Edit allocation' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('allocation-bar')).toHaveCount(before - 1)

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByTestId('allocation-bar')).toHaveCount(before)
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect(page.getByTestId('allocation-bar')).toHaveCount(before - 1)
  })

  test('undoes/redoes with the keyboard and ignores the shortcut while typing', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    const before = await page.getByTestId('allocation-bar').count()
    await page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' }).click()
    await page.getByRole('dialog', { name: 'Edit allocation' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('allocation-bar')).toHaveCount(before - 1)

    // Typing in the search box must NOT trigger undo.
    await page.getByLabel('Search people').click()
    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('allocation-bar')).toHaveCount(before - 1)

    // Outside an input, ⌘Z undoes and ⌘⇧Z redoes.
    await page.getByTestId('scheduler-grid').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('allocation-bar')).toHaveCount(before)
    await page.keyboard.press('Meta+Shift+z')
    await expect(page.getByTestId('allocation-bar')).toHaveCount(before - 1)
  })
})
