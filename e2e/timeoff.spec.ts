import { test, expect } from '@playwright/test'

// Covers US-TOF-01..04.
test.describe('Time off', () => {
  test('books time off and shows it as a labelled block on the schedule', async ({ page }) => {
    await page.goto('/timeoff')
    await page.getByRole('button', { name: 'Add time off' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add time off' })
    await dialog.getByLabel('Resource').selectOption({ label: 'Nike Spiros' })
    await dialog.getByLabel('Start').fill('2026-06-17')
    await dialog.getByLabel('End').fill('2026-06-19')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByTestId('timeoff-row').filter({ hasText: 'Nike Spiros' })).toBeVisible()

    // It renders as a labelled block on Nike's lane.
    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    await expect(page.locator('[data-resource-id="r-nike"]').getByTestId('timeoff-block')).toBeVisible()
  })

  test('shows a human-readable type label in the list (not the raw enum)', async ({ page }) => {
    await page.goto('/timeoff')
    const row = page.getByTestId('timeoff-row').filter({ hasText: 'Tyler Nix' })
    await expect(row).toContainText('Holiday')
    await expect(row).not.toContainText('holiday')
  })

  test('edits a time-off entry and reflects the new type', async ({ page }) => {
    await page.goto('/timeoff')
    await page.getByTestId('timeoff-row').filter({ hasText: 'Tyler Nix' }).getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit time off' })
    await dialog.getByLabel('Type').selectOption({ label: 'Sick' })
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('timeoff-row').filter({ hasText: 'Tyler Nix' })).toContainText('Sick')
  })

  test('deletes a time-off entry after confirmation and restores it with undo', async ({ page }) => {
    await page.goto('/timeoff')
    await page.getByTestId('timeoff-row').filter({ hasText: 'Tyler Nix' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog', { name: 'Delete time off?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('timeoff-row')).toHaveCount(0)

    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('timeoff-row').filter({ hasText: 'Tyler Nix' })).toBeVisible()
  })
})
