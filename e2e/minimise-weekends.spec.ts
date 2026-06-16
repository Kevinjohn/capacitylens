import { test, expect, type Locator } from '@playwright/test'
import { openApp } from './helpers'

test.use({ reducedMotion: 'reduce' })

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
}

// Read the leftmost visible date-header cell + how many day columns are on screen. Used to
// guard (a) the zoom scroll-anchor (the left-edge date must not drift onto the weekend) and
// (b) the weekend-aware fit (a "1-week" view must show ~1 week, not ~1.5).
async function probe(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="scheduler-grid"]') as HTMLElement
    const header = document.querySelector('[role="columnheader"][aria-label="Dates"]') as HTMLElement
    const dayTier = header?.querySelector('.flex.flex-auto')
    const cells = dayTier ? Array.from(dayTier.children) : []
    const gridRect = grid.getBoundingClientRect()
    const laneLeft = gridRect.left + 256 // past the sticky left column
    let leftDate = ''
    let visibleDays = 0
    for (const c of cells) {
      const r = (c as HTMLElement).getBoundingClientRect()
      if (!leftDate && r.right > laneLeft + 1) leftDate = (c.textContent || '').trim()
      if (r.right > laneLeft && r.left < gridRect.right) visibleDays++
    }
    return { leftDate, visibleDays }
  })
}

// Covers US-SET-05. "Minimise weekends" (device-global, default ON) shrinks the
// Sat/Sun columns to a sliver and labels both "S"; off restores full-width Sat/Sun columns.
// All label assertions are scoped to the date header (role=columnheader "Dates") so a stray
// "S" elsewhere (e.g. an avatar initial) can't match. 1w zoom = the widest, clearest columns.
test.describe('Minimise weekends', () => {
  test('ON by default: weekend columns are narrow and labelled "S"', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '1w', exact: true }).click()
    const header = page.getByRole('columnheader', { name: 'Dates' })

    // Weekdays keep their three-letter label; both weekend days collapse to a single "S".
    expect(await header.getByText('Wed', { exact: true }).count()).toBeGreaterThan(0)
    expect(await header.getByText('S', { exact: true }).count()).toBeGreaterThanOrEqual(2)
    await expect(header.getByText('Sat', { exact: true })).toHaveCount(0)
    await expect(header.getByText('Sun', { exact: true })).toHaveCount(0)

    // A weekend column is visibly narrower than a weekday column.
    const weekend = await box(header.getByText('S', { exact: true }).first().locator('..'))
    const weekday = await box(header.getByText('Wed', { exact: true }).first().locator('..'))
    expect(weekend.width).toBeLessThan(weekday.width)
  })

  test('toggling it off in Settings restores full-width Sat/Sun columns', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    const toggle = page.getByRole('switch', { name: 'Minimise weekends' })
    await expect(toggle).toHaveAttribute('aria-checked', 'true') // default on

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('button', { name: '1w', exact: true }).click()
    const header = page.getByRole('columnheader', { name: 'Dates' })

    // Weekends now read Sat/Sun, and nothing is collapsed to "S".
    await expect(header.getByText('Sat', { exact: true }).first()).toBeVisible()
    await expect(header.getByText('Sun', { exact: true }).first()).toBeVisible()
    await expect(header.getByText('S', { exact: true })).toHaveCount(0)

    // Weekend and weekday columns are now the same width.
    const weekend = await box(header.getByText('Sat', { exact: true }).first().locator('..'))
    const weekday = await box(header.getByText('Wed', { exact: true }).first().locator('..'))
    expect(Math.abs(weekend.width - weekday.width)).toBeLessThan(2)
  })

  test('the choice survives a reload (device-global pref)', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    await page.getByRole('switch', { name: 'Minimise weekends' }).click() // → off
    await page.reload()
    // Re-pick the company after reload (activeAccountId is never persisted) and re-open Settings.
    await page.getByRole('button', { name: 'Studio North', exact: true }).click()
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page.getByRole('switch', { name: 'Minimise weekends' })).toHaveAttribute('aria-checked', 'false')
  })

  test('a 1-week zoom shows ~1 week (weekend-aware fit), not ~1.5', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 })
    await openApp(page) // minimise on by default
    await page.getByRole('button', { name: '1w', exact: true }).click()
    const { visibleDays } = await probe(page)
    // With the fit, the working week fills the viewport: ~7 days. The narrow-weekend under-fill
    // bug showed ~11–12. A 2-week zoom of the same width would show ~14, so <=9 pins "~1 week".
    expect(visibleDays).toBeGreaterThanOrEqual(6)
    expect(visibleDays).toBeLessThanOrEqual(9)
  })

  test('zoom flips preserve the left-edge date (no drift onto the weekend)', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '1w', exact: true }).click()
    const before = await probe(page)
    // Round-trip the zoom; the integer-pixel geometry must round-trip the left-edge date exactly.
    await page.getByRole('button', { name: '2w', exact: true }).click()
    await page.getByRole('button', { name: '1w', exact: true }).click()
    const after = await probe(page)
    expect(after.leftDate).toBe(before.leftDate)
    // And it must be a weekday (the focused Monday), never drifted back onto the narrow "S" weekend.
    expect(before.leftDate).not.toMatch(/S$/)
  })

  test('a bar dragged across the narrowed weekend commits a later date (no crash)', async ({ page }) => {
    await openApp(page) // minimise on by default
    await page.getByRole('button', { name: '1w', exact: true }).click()

    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })
    await bar.click()
    let dialog = page.getByRole('dialog', { name: 'Edit allocation' })
    const startBefore = await dialog.getByLabel('Start Date', { exact: true }).inputValue()
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    // Drag the body well to the right — far enough to cross the narrow Sat/Sun columns.
    const b0 = await box(bar)
    const cy = b0.y + b0.height / 2
    await page.mouse.move(b0.x + b0.width / 2, cy)
    await page.mouse.down()
    await page.mouse.move(b0.x + b0.width / 2 + 300, cy, { steps: 10 })
    await page.mouse.up()

    await bar.click()
    dialog = page.getByRole('dialog', { name: 'Edit allocation' })
    const startAfter = await dialog.getByLabel('Start Date', { exact: true }).inputValue()
    expect(startAfter > startBefore).toBe(true) // ISO dates sort chronologically
  })
})
