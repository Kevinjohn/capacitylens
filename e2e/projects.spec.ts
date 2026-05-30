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

  test('adds and removes phases inside the project dialog', async ({ page }) => {
    await openApp(page, 'Studio North', '/projects')
    await page.getByTestId('project-row').filter({ hasText: 'Project Lightning' }).getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit project' })

    await dialog.getByLabel('New phase').fill('Launch')
    await dialog.getByRole('button', { name: 'Add phase' }).click()
    await expect(dialog.getByText('Launch')).toBeVisible()

    // Remove the seeded "Discovery" phase.
    await dialog.locator('li').filter({ hasText: 'Discovery' }).getByRole('button', { name: 'Remove' }).click()
    await expect(dialog.getByText('Discovery')).toHaveCount(0)
  })

  test('deletes a project and cascades its tasks, restorable with undo', async ({ page }) => {
    await openApp(page, 'Studio North', '/projects')
    await page.getByTestId('project-row').filter({ hasText: 'Project Lightning' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog', { name: 'Delete project?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('project-row').filter({ hasText: 'Project Lightning' })).toHaveCount(0)

    // Its tasks are gone.
    await page.getByRole('link', { name: 'Tasks' }).click()
    await expect(page.getByTestId('task-row').filter({ hasText: 'Wireframes' })).toHaveCount(0)

    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('task-row').filter({ hasText: 'Wireframes' })).toBeVisible()
  })
})
