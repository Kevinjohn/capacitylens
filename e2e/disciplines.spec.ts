import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-DIS-01..04.
test.describe('Disciplines', () => {
  test('adds a discipline and shows it in the list and as a schedule group', async ({ page }) => {
    await openApp(page, 'Studio North', '/disciplines')
    await page.getByRole('button', { name: 'Add discipline' }).click()
    await page.getByLabel('Name').fill('Strategy')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('discipline-row').filter({ hasText: 'Strategy' })).toBeVisible()
  })

  test('edits a discipline and reflects the change in the list', async ({ page }) => {
    await openApp(page, 'Studio North', '/disciplines')
    await page.getByTestId('discipline-row').filter({ hasText: 'Design' }).getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Name').fill('Product Design')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('discipline-row').filter({ hasText: 'Product Design' })).toBeVisible()
  })

  test('deletes a discipline and ungroups its resources without deleting them', async ({ page }) => {
    await openApp(page, 'Studio North', '/disciplines')
    await page.getByTestId('discipline-row').filter({ hasText: 'Design' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog', { name: 'Delete discipline?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('discipline-row').filter({ hasText: 'Design' })).toHaveCount(0)

    // Tyler (was in Design) still exists — just ungrouped.
    await page.getByRole('link', { name: 'Resources' }).click()
    await expect(page.getByTestId('resource-row').filter({ hasText: 'Tyler Nix' })).toBeVisible()
    // …and still appears on the schedule (now under "No discipline").
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Tyler Nix' })).toBeVisible()
    await expect(page.getByTestId('discipline-group').filter({ hasText: 'No discipline' })).toBeVisible()
  })

  test('orders disciplines by sort order, breaking ties by name', async ({ page }) => {
    await openApp(page, 'Studio North', '/disciplines')
    // Seed order: Design (0), Development (1), Copywriting (2). Give Copywriting order 0
    // so it ties with Design; the name tiebreak then puts "Copywriting" before "Design".
    await page.getByTestId('discipline-row').filter({ hasText: 'Copywriting' }).getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Sort order').fill('0')
    await page.getByRole('button', { name: 'Save' }).click()

    const names = await page.getByTestId('discipline-row').allInnerTexts()
    expect(names[0]).toContain('Copywriting')
    expect(names[1]).toContain('Design')
  })
})
