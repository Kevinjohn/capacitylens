import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-FIL-01..07. Seed has 6 allocations (one tentative: Tyler's Visual Design)
// and 5 resource rows across Design/Development/Copywriting.
test.describe('Filters', () => {
  test('searches resources by name and hides non-matching rows', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Nike Spiros' })).toBeVisible()
    await page.getByLabel('Search people').fill('Tyler')
    await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Tyler Nix' })).toBeVisible()
    await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Nike Spiros' })).toHaveCount(0)
  })

  test('filters the schedule by discipline', async ({ page }) => {
    await openApp(page)
    await page.getByLabel('Filter by discipline').selectOption({ label: 'Development' })
    await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Nike Spiros' })).toBeVisible()
    await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Tyler Nix' })).toHaveCount(0)
  })

  test('filters bars to a client', async ({ page }) => {
    await openApp(page)
    await page.getByLabel('Filter by client').selectOption({ label: 'Globex' })
    // Globex only owns Brand Themes → the schedule collapses to just that work by default.
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' })).toBeVisible()
    await expect(page.getByTestId('allocation-bar')).toHaveCount(1)
    // Opting into "Show unallocated" brings back the resources with no Globex work,
    // dimmed, so you can see who's free to staff.
    await page.getByLabel('Show unallocated').check()
    await expect(page.locator('[data-testid="scheduler-row"][data-dimmed]').first()).toBeVisible()
  })

  test('filters the schedule to a single project', async ({ page }) => {
    await openApp(page)
    await page.getByLabel('Filter by project').selectOption('p-brand')
    await expect(page.getByTestId('allocation-bar')).toHaveCount(1)
  })

  test('hides tentative bars while capacity still counts them', async ({ page }) => {
    await openApp(page)
    const before = await page.getByTestId('allocation-bar').count()
    await page.getByLabel('Hide tentative').check()
    await expect(page.getByTestId('allocation-bar')).toHaveCount(before - 1) // Tyler's tentative bar
    // Capacity is still truthful: Tyler's 3-4 June over-marker remains.
    await expect(page.getByTestId('over-marker').first()).toBeVisible()
  })

  test('clears all active filters with the Clear button', async ({ page }) => {
    await openApp(page)
    const all = await page.getByTestId('allocation-bar').count()
    await page.getByLabel('Filter by project').selectOption('p-brand')
    await expect(page.getByTestId('allocation-bar')).toHaveCount(1)
    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByTestId('allocation-bar')).toHaveCount(all)
  })

  test('shows the filtered empty state when nothing matches', async ({ page }) => {
    await openApp(page)
    await page.getByLabel('Search people').fill('nobody-matches-this')
    await expect(page.getByTestId('scheduler-empty')).toBeVisible()
    await expect(page.getByTestId('scheduler-empty')).toContainText(/match the current filters/i)
  })

  test('filters the schedule to a repeatable activity (the activity lens)', async ({ page }) => {
    await openApp(page)
    // Seed books "Design" (a repeatable activity) for Alex across 8-10 June.
    await page.getByLabel('Filter by activity').selectOption('kind:repeatable')
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Design' })).toBeVisible()
    await expect(page.getByTestId('allocation-bar')).toHaveCount(1)
  })

  test('the activity lens is mutually exclusive with the client / project lens', async ({ page }) => {
    await openApp(page)
    // Activate a project lens, then switch to the activity lens — the project dropdown resets.
    await page.getByLabel('Filter by project').selectOption('p-brand')
    await expect(page.getByLabel('Filter by project')).toHaveValue('p-brand')
    await page.getByLabel('Filter by activity').selectOption('kind:repeatable')
    await expect(page.getByLabel('Filter by project')).toHaveValue('')

    // And back the other way: choosing a project clears the activity lens.
    await page.getByLabel('Filter by project').selectOption('p-brand')
    await expect(page.getByLabel('Filter by activity')).toHaveValue('')
  })
})
