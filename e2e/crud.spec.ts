import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

test.describe('CRUD + demo lifecycle', () => {
  test('a project cannot be saved without a client', async ({ page }) => {
    await openApp(page)
    await page.getByRole('link', { name: 'Projects' }).click()
    await page.getByRole('button', { name: 'Add project' }).click()

    await page.getByLabel('Name').fill('Clientless Project')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByRole('alert')).toContainText(/must belong to a client/i)
  })

  test('adding a client is intentionally reset by a demo reload', async ({ page }) => {
    await openApp(page)
    await page.getByRole('link', { name: 'Clients' }).click()
    await page.getByRole('button', { name: 'Add client' }).click()

    await page.getByLabel('Name').fill('Persisted Client')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('Persisted Client')).toBeVisible()

    // The zero-setup demo is memory-only; reload restores the canonical seed.
    await page.waitForTimeout(500)
    await openApp(page)
    await page.getByRole('link', { name: 'Clients' }).click()
    await expect(page.getByText('Persisted Client')).toHaveCount(0)
  })

  test('exports the dataset and re-imports it (round-trip)', async ({ page }) => {
    await openApp(page)
    await page.getByRole('link', { name: 'Clients' }).click()
    await page.getByRole('button', { name: 'Add client' }).click()
    await page.getByLabel('Name').fill('RoundTrip Co')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('RoundTrip Co')).toBeVisible()

    // Export and capture the downloaded file.
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('export-data').click()
    const file = await (await downloadPromise).path()

    // Let the debounced in-memory write settle, then reload to restore the seed.
    await page.waitForTimeout(400)
    // Clear device preferences and reload -> reseeds without our client.
    await page.evaluate(() => localStorage.clear())
    await openApp(page)
    await page.getByRole('link', { name: 'Clients' }).click()
    await expect(page.getByText('RoundTrip Co')).toHaveCount(0)

    // Importing the file restores it — confirm the replace in the dialog first.
    await page.getByTestId('import-input').setInputFiles(file)
    await expect(page.getByRole('dialog', { name: 'Import data?' })).toBeVisible()
    await page.getByRole('button', { name: 'Replace data' }).click()
    await page.getByRole('link', { name: 'Clients' }).click()
    await expect(page.getByText('RoundTrip Co')).toBeVisible()
  })
})
