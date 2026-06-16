import { test, expect, type Locator } from '@playwright/test'
import { openApp } from './helpers'

test.use({ reducedMotion: 'reduce' })

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no bounding box')
  return b
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
