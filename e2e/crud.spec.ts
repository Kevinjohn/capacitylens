import { test, expect } from '@playwright/test'

test.describe('CRUD + persistence', () => {
  test('a project cannot be saved without a client', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Projects' }).click()
    await page.getByRole('button', { name: 'Add project' }).click()

    await page.getByLabel('Name').fill('Clientless Project')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByRole('alert')).toContainText(/must belong to a client/i)
  })

  test('adding a client persists across a reload', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Clients' }).click()
    await page.getByRole('button', { name: 'Add client' }).click()

    await page.getByLabel('Name').fill('Persisted Client')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('Persisted Client')).toBeVisible()

    // allow the debounced persist to flush, then reload
    await page.waitForTimeout(500)
    await page.reload()
    await page.getByRole('link', { name: 'Clients' }).click()
    await expect(page.getByText('Persisted Client')).toBeVisible()
  })

  test('exports the dataset and re-imports it (round-trip)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Clients' }).click()
    await page.getByRole('button', { name: 'Add client' }).click()
    await page.getByLabel('Name').fill('RoundTrip Co')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('RoundTrip Co')).toBeVisible()

    // Export and capture the downloaded file.
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('export-data').click()
    const file = await (await downloadPromise).path()

    // Let the debounced persist settle first, otherwise the unload-flush (which
    // writes any pending in-memory change) would re-persist our client *after* the
    // clear and resurrect it on reload. Once settled there is no pending write.
    await page.waitForTimeout(400)
    // Wipe storage and reload -> reseeds without our client.
    await page.evaluate(() => localStorage.clear())
    await page.reload()
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
