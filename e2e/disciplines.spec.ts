import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-DIS-01..04.
test.describe('Disciplines', () => {
  test('adds a discipline and shows it in the list and as a schedule group', async ({ page }) => {
    await openApp(page, 'Studio North', '/disciplines')
    await page.getByRole('button', { name: 'Add discipline' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Strategy')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('discipline-row').filter({ hasText: 'Strategy' })).toBeVisible()
  })

  test('edits a discipline and reflects the change in the list', async ({ page }) => {
    await openApp(page, 'Studio North', '/disciplines')
    await page.getByTestId('discipline-row').filter({ hasText: 'Design' }).getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Product Design')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('discipline-row').filter({ hasText: 'Product Design' })).toBeVisible()
  })

  test('deletes a discipline and ungroups its resources without deleting them', async ({ page }) => {
    await openApp(page, 'Studio North', '/disciplines')
    await page.getByTestId('discipline-row').filter({ hasText: 'Design' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('alertdialog', { name: 'Delete discipline?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('discipline-row').filter({ hasText: 'Design' })).toHaveCount(0)

    // Tyler (was in Design) still exists — just ungrouped.
    await page.getByRole('link', { name: 'Resources' }).click()
    await expect(page.getByTestId('resource-row').filter({ hasText: 'Tyler Nix' })).toBeVisible()
    // …and still appears on the schedule (now under "No discipline").
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Tyler Nix' })).toBeVisible()
    await expect(page.getByTestId('discipline-group').filter({ hasText: 'No discipline' })).toBeVisible()
  })
})
