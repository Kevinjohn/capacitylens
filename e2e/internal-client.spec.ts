import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-CLI-04 — the built-in "Internal" pseudo-client.
test.describe('Internal client', () => {
  test('Internal appears in the client list as a read-only built-in (no Edit/Delete)', async ({ page }) => {
    await openApp(page, 'Studio North', '/clients')
    const internalRow = page.getByTestId('client-row').filter({ hasText: 'Internal' })
    await expect(internalRow).toBeVisible()
    await expect(internalRow).toContainText('Built-in')
    // No rename/delete affordance on the built-in row…
    await expect(internalRow.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await expect(internalRow.getByRole('button', { name: 'Delete' })).toHaveCount(0)
    // …while a normal client still has them.
    const acmeRow = page.getByTestId('client-row').filter({ hasText: 'Acme' })
    await expect(acmeRow.getByRole('button', { name: 'Edit' })).toBeVisible()
    await expect(acmeRow.getByRole('button', { name: 'Delete' })).toBeVisible()
  })

  test('an activity can be created under Internal with no project (internal kind)', async ({ page }) => {
    await openApp(page, 'Studio North', '/activities')
    await page.getByRole('button', { name: 'Add activity' }).click()
    await page.getByLabel('Name').fill('Team retro')
    // Internal kind → project picker is hidden; the activity is project-less and buckets under Internal.
    await page.getByRole('radio', { name: 'Internal' }).click()
    await expect(page.getByLabel('Project')).toHaveCount(0)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(
      page.getByTestId('internal-activities').getByTestId('activity-row').filter({ hasText: 'Team retro' }),
    ).toBeVisible()
  })

  test('Filter by client → Internal shows project-less (Internal-bucketed) work', async ({ page }) => {
    await openApp(page)
    // Widen + scroll to the origin so the seed's project-less repeatable "Design" booking (Alex,
    // 8–10 June) is on-screen.
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    // A clearly project-owned bar (Globex / Brand Themes) is visible before filtering…
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' })).toBeVisible()
    // …and the project-less repeatable "Design" booking is too (assigned to Alex Rivera's row).
    const alexRow = page.getByTestId('scheduler-row').filter({ hasText: 'Alex Rivera' })
    await expect(alexRow.getByTestId('allocation-bar')).not.toHaveCount(0)
    // Filtering by the Internal client KEEPS the project-less work (it derives client = Internal)
    // and HIDES project work owned by other clients (Brand System under Globex is gone).
    await page.getByLabel('Filter by client').selectOption({ label: 'Internal' })
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' })).toHaveCount(0)
    await expect(page.getByTestId('allocation-bar')).not.toHaveCount(0) // the Internal-bucketed Design remains
  })
})
