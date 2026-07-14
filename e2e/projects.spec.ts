import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-PRJ-01..04.
test.describe('Projects', () => {
  test('rejects a project without a client and adds one with a client', async ({ page }) => {
    await openApp(page, 'Studio North', '/projects')
    await page.getByRole('button', { name: 'Add project' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Apollo')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText(/must belong to a client/i)

    await page.getByLabel('Client').selectOption({ label: 'Acme Inc.' })
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('project-row').filter({ hasText: 'Apollo' })).toBeVisible()
  })

  test('edits a project name', async ({ page }) => {
    await openApp(page, 'Studio North', '/projects')
    await page.getByTestId('project-row').filter({ hasText: 'Brand Themes' }).getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Brand Refresh')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('project-row').filter({ hasText: 'Brand Refresh' })).toBeVisible()
  })

  // P2.5b: the per-row destructive action ARCHIVES (hidden from the active list, fully retained — NOT
  // a hard cascade-delete). Archiving is undoable via the local store.
  test('archiving a project hides it from the list, restorable with undo', async ({ page }) => {
    await openApp(page, 'Studio North', '/projects')
    await page.getByTestId('project-row').filter({ hasText: 'Project Lightning' }).getByRole('button', { name: 'Archive Project Lightning' }).click()
    await page.getByRole('dialog', { name: 'Archive project?' }).getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(page.getByTestId('project-row').filter({ hasText: 'Project Lightning' })).toHaveCount(0)

    // Undo restores the archived project to the active list.
    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('project-row').filter({ hasText: 'Project Lightning' })).toBeVisible()
  })
})
