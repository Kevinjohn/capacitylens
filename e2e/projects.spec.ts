import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-PRJ-01..04.
test.describe('Projects', () => {
  test('rejects a project without a client and adds one with a client', async ({ page }) => {
    await openApp(page, 'Studio North', '/projects')
    await page.getByRole('button', { name: 'Add project' }).click()
    await page.getByLabel('Name').fill('Apollo')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText(/must belong to a client/i)

    await page.getByLabel('Client').selectOption({ label: 'Acme Inc.' })
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('project-row').filter({ hasText: 'Apollo' })).toBeVisible()
  })

  test('edits a project name', async ({ page }) => {
    await openApp(page, 'Studio North', '/projects')
    await page.getByTestId('project-row').filter({ hasText: 'Brand Themes' }).getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Name').fill('Brand Refresh')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('project-row').filter({ hasText: 'Brand Refresh' })).toBeVisible()
  })

  test('deletes a project and cascades its activities, restorable with undo', async ({ page }) => {
    await openApp(page, 'Studio North', '/projects')
    await page.getByTestId('project-row').filter({ hasText: 'Project Lightning' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog', { name: 'Delete project?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('project-row').filter({ hasText: 'Project Lightning' })).toHaveCount(0)

    // Its activities are gone.
    await page.getByRole('link', { name: 'Activities' }).click()
    await expect(page.getByTestId('activity-row').filter({ hasText: 'Wireframes' })).toHaveCount(0)

    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('activity-row').filter({ hasText: 'Wireframes' })).toBeVisible()
  })
})
