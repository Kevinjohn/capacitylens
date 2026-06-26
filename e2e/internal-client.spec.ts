import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-CLI-04 — the built-in "Internal" pseudo-client.
test.describe('Internal client', () => {
  test('Internal is HIDDEN from the Clients management list, but stays selectable + a binding target', async ({ page }) => {
    await openApp(page, 'Studio North', '/clients')
    // Internal is a behind-the-scenes data anchor — it does NOT appear in the management list…
    await expect(page.getByTestId('client-row').filter({ hasText: 'Internal' })).toHaveCount(0)
    // …while normal clients are listed with their Edit/Archive affordances (P2.5b: the row's
    // destructive action archives — Internal has no such row, so it can't be archived from here).
    const acmeRow = page.getByTestId('client-row').filter({ hasText: 'Acme' })
    await expect(acmeRow).toBeVisible()
    await expect(acmeRow.getByRole('button', { name: 'Edit' })).toBeVisible()
    await expect(acmeRow.getByRole('button', { name: 'Archive Acme Inc.' })).toBeVisible()

    // It is still SELECTABLE as a project's client in ProjectForm's client picker (name chosen
    // WITHOUT "Internal" in it, so the client-label assertion below can't pass by accident).
    // Navigate IN-APP (a fresh page.goto would re-show the account picker — the active account
    // isn't persisted).
    await page.getByRole('link', { name: 'Projects' }).click()
    await page.getByRole('button', { name: 'Add project' }).click()
    await page.getByLabel('Name').fill('Quarterly planning')
    await page.getByLabel('Client').selectOption({ label: 'Internal' })
    await page.getByRole('button', { name: 'Save' }).click()

    // …and it still functions as a binding target: a project bound to Internal resolves its client
    // label to "Internal", even though Internal isn't a row in the Clients list.
    await expect(
      page.getByTestId('project-row').filter({ hasText: 'Quarterly planning' }),
    ).toContainText('· Internal')
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
