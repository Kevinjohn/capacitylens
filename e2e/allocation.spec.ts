import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-ALL-01..08. The allocation editor (modal) opened from the row "+" or by
// clicking a bar. Seed bars live in June 2026 and are visible at 4w with scroll reset.
test.describe('Allocation editor', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
  })

  test('creates an allocation from the row + button (assignee preselected)', async ({ page }) => {
    const before = await page.getByTestId('allocation-bar').count()
    await page.getByRole('button', { name: 'Add allocation for Nike Spiros' }).click()
    const dialog = page.getByRole('dialog', { name: 'New allocation' })
    // In row-create mode the assignee is fixed to the clicked row, so there's no
    // Assignee select — the dialog title names them instead.
    await expect(dialog.getByRole('heading')).toContainText('Nike Spiros')
    await expect(dialog.getByLabel('Assignee')).toHaveCount(0)
    await dialog.getByLabel('Project', { exact: true }).selectOption('p-acme')
    await dialog.getByLabel('Activity', { exact: true }).selectOption('t-wires')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('allocation-bar')).toHaveCount(before + 1)
  })

  test('edits an allocation and reflects the change on the bar', async ({ page }) => {
    await page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit allocation' })
    await dialog.getByLabel('Hours / day').fill('6')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Wireframes' })).toContainText('6h')
  })

  test('duplicates an allocation from the edit dialog', async ({ page }) => {
    const before = await page.getByTestId('allocation-bar').count()
    await page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' }).click()
    await page.getByRole('dialog', { name: 'Edit allocation' }).getByRole('button', { name: 'Duplicate' }).click()
    await expect(page.getByTestId('allocation-bar')).toHaveCount(before + 1)
  })

  test('deletes an allocation from the edit dialog and ⌘Z restores it', async ({ page }) => {
    const before = await page.getByTestId('allocation-bar').count()
    await page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' }).click()
    await page.getByRole('dialog', { name: 'Edit allocation' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('allocation-bar')).toHaveCount(before - 1)
    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('allocation-bar')).toHaveCount(before)
  })

  test('adds a new activity inline and uses it for the allocation', async ({ page }) => {
    await page.getByRole('button', { name: 'Add allocation for Nike Spiros' }).click()
    const dialog = page.getByRole('dialog', { name: 'New allocation' })
    await dialog.getByLabel('Project', { exact: true }).selectOption('p-acme')
    await dialog.getByLabel('New activity name').fill('Inline Activity')
    await dialog.getByRole('button', { name: 'Add activity' }).click()
    await expect(dialog.getByLabel('Activity', { exact: true })).toHaveValue(/.+/) // a real activity id is now selected
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Inline Activity' })).toBeVisible()
  })

  test('reassigns an allocation to another resource via the dialog', async ({ page }) => {
    await page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' }).click()
    await page.getByRole('dialog', { name: 'Edit allocation' }).getByLabel('Assignee').selectOption('r-nike')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('[data-resource-id="r-nike"]').getByTestId('allocation-bar').filter({ hasText: 'Brand System' })).toBeVisible()
  })

  test('snaps the project to a placeholder bound project when chosen', async ({ page }) => {
    // Placeholders are hidden by default (per-account pref) — turn them on in Settings first so
    // the seeded placeholder's lane (and its "+" button) appears in the schedule.
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('switch', { name: 'Show placeholders' }).click()
    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    // Open create mode from the placeholder's OWN row (in create mode the assignee is fixed to the
    // clicked row). The seeded "Senior Designer" slot shows as "Placeholder" and is bound to p-acme.
    await page.getByRole('button', { name: 'Add allocation for Placeholder' }).click()
    const dialog = page.getByRole('dialog', { name: 'New allocation' })
    const project = dialog.getByLabel('Project', { exact: true })
    await expect(project).toHaveValue('p-acme') // bound project preselected
    // "Locked" = restricted to the bound project + the project-less option, but the select
    // stays ENABLED so a placeholder can still take project-less (internal/cross-project) activities. A
    // non-bound project ("Brand Themes") is not offered.
    await expect(project).toBeEnabled()
    await expect(project.getByRole('option', { name: 'No project (internal / cross-project)' })).toBeAttached()
    await expect(project.getByRole('option', { name: /Brand Themes/ })).toHaveCount(0)
  })

  test('rejects empty dates and zero hours with a field-associated error', async ({ page }) => {
    await page.getByRole('button', { name: 'Add allocation for Nike Spiros' }).click()
    const dialog = page.getByRole('dialog', { name: 'New allocation' })
    await dialog.getByLabel('Project', { exact: true }).selectOption('p-acme')
    await dialog.getByLabel('Activity', { exact: true }).selectOption('t-wires')

    await dialog.getByLabel('Start').fill('')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText(/start and end dates are required/i)

    await dialog.getByLabel('Start').fill('2026-06-01')
    // Anchored so it hits the "End" date field and not the "Include weekends as working
    // days" checkbox (its label also contains "end"); a required field's label carries a
    // trailing " *", so an exact match won't do.
    await dialog.getByLabel(/^End/).fill('2026-06-02')
    await dialog.getByLabel('Hours / day').fill('0')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText(/greater than 0/i)
  })
})
