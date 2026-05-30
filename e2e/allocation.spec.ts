import { test, expect } from '@playwright/test'

// Covers US-ALL-01..08. The allocation editor (modal) opened from the row "+" or by
// clicking a bar. Seed bars live in June 2026 and are visible at 4w with scroll reset.
test.describe('Allocation editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
  })

  test('creates an allocation from the row + button (assignee preselected)', async ({ page }) => {
    const before = await page.getByTestId('allocation-bar').count()
    await page.getByRole('button', { name: 'Add allocation for Nike Spiros' }).click()
    const dialog = page.getByRole('dialog', { name: 'New allocation' })
    await expect(dialog.getByLabel('Assignee')).toHaveValue('r-nike')
    await dialog.getByLabel('Project', { exact: true }).selectOption('p-acme')
    await dialog.getByLabel('Task', { exact: true }).selectOption('t-wires')
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

  test('adds a new task inline and uses it for the allocation', async ({ page }) => {
    await page.getByRole('button', { name: 'Add allocation for Nike Spiros' }).click()
    const dialog = page.getByRole('dialog', { name: 'New allocation' })
    await dialog.getByLabel('Project', { exact: true }).selectOption('p-acme')
    await dialog.getByLabel('New task name').fill('Inline Task')
    await dialog.getByRole('button', { name: 'Add task' }).click()
    await expect(dialog.getByLabel('Task', { exact: true })).toHaveValue(/.+/) // a real task id is now selected
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('allocation-bar').filter({ hasText: 'Inline Task' })).toBeVisible()
  })

  test('reassigns an allocation to another resource via the dialog', async ({ page }) => {
    await page.getByTestId('allocation-bar').filter({ hasText: 'Brand System' }).click()
    await page.getByRole('dialog', { name: 'Edit allocation' }).getByLabel('Assignee').selectOption('r-nike')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('[data-resource-id="r-nike"]').getByTestId('allocation-bar').filter({ hasText: 'Brand System' })).toBeVisible()
  })

  test('locks the project when a placeholder assignee is chosen', async ({ page }) => {
    await page.getByRole('button', { name: 'Add allocation for Nike Spiros' }).click()
    const dialog = page.getByRole('dialog', { name: 'New allocation' })
    await dialog.getByLabel('Assignee').selectOption('r-ph-designer') // Senior Designer (slot), bound to p-acme
    const project = dialog.getByLabel('Project', { exact: true })
    await expect(project).toBeDisabled()
    await expect(project).toHaveValue('p-acme')
  })

  test('rejects empty dates and zero hours with a field-associated error', async ({ page }) => {
    await page.getByRole('button', { name: 'Add allocation for Nike Spiros' }).click()
    const dialog = page.getByRole('dialog', { name: 'New allocation' })
    await dialog.getByLabel('Project', { exact: true }).selectOption('p-acme')
    await dialog.getByLabel('Task', { exact: true }).selectOption('t-wires')

    await dialog.getByLabel('Start').fill('')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText(/start and end dates are required/i)

    await dialog.getByLabel('Start').fill('2026-06-01')
    await dialog.getByLabel('End').fill('2026-06-02')
    await dialog.getByLabel('Hours / day').fill('0')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText(/greater than 0/i)
  })
})
