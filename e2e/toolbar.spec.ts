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

    // The work bars go inert via a SINGLE ancestor layer (ResourceLane's BarsLayer), not a
    // per-bar attribute — so the bar carries no `inert` of its own, but its nearest [inert]
    // ancestor makes it non-interactive, off the tab order, and removed from the a11y tree.
    // Prove the semantics hold THROUGH the ancestor: every bar is matched by `[inert] <bar>`,
    // and an attempt to focus one is refused (inert subtrees can't take focus).
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    const bar = page.getByTestId('allocation-bar').first()
    await expect(bar).toBeVisible()
    // The bar lives under an [inert] ancestor (the BarsLayer); no bar is outside one.
    await expect(page.locator('[inert] [data-testid="allocation-bar"]').first()).toBeVisible()
    await expect(page.locator('[data-testid="allocation-bar"]:not([inert] *)')).toHaveCount(0)
    // Inert ⇒ unfocusable: a focus() attempt leaves activeElement off the bar.
    expect(await bar.evaluate((el) => { el.focus(); return document.activeElement === el })).toBe(false)

    // Toggling back to Work clears the ancestor inert — the bar is interactive (focusable) again.
    await work.click()
    await expect(page.locator('[inert] [data-testid="allocation-bar"]')).toHaveCount(0)
    expect(await bar.evaluate((el) => { el.focus(); return document.activeElement === el })).toBe(true)
  })

  // The Undo/Redo toolbar buttons are intentionally hidden for now (undo/redo lives on
  // ⌘Z / ⌘⇧Z via AppShell — see SchedulerToolbar + DECISIONS.md), so there are no
  // buttons to drive here; the keyboard path below is the coverage for that feature.
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
