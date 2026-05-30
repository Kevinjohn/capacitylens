import { test, expect } from '@playwright/test'

const EMPTY_FLOATY = JSON.stringify({
  schemaVersion: 2,
  data: { disciplines: [], resources: [], clients: [], projects: [], phases: [], tasks: [], allocations: [], timeOff: [] },
})

const importFile = (page: import('@playwright/test').Page, name: string, body: string) =>
  page.getByTestId('import-input').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(body) })

// Covers US-DAT-02..04, 06. (Export round-trip + persist-across-reload + seed/no-reseed
// on a genuine wipe are covered in e2e/crud.spec.ts.)
test.describe('Data import/export', () => {
  test('seeds a demo dataset on first load', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Tyler Nix')).toBeVisible()
  })

  test('import shows a confirmation that replaces all data; Cancel keeps the data', async ({ page }) => {
    await page.goto('/')
    await importFile(page, 'incoming.json', EMPTY_FLOATY)

    const dialog = page.getByRole('dialog', { name: 'Import data?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(/replaces all current data/i)
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    // Data is untouched — the seeded resource is still there.
    await expect(page.getByText('Tyler Nix')).toBeVisible()
  })

  test('confirming an import replaces the dataset and ⌘Z restores it', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Tyler Nix')).toBeVisible()
    await importFile(page, 'empty.json', EMPTY_FLOATY)
    await page.getByRole('dialog', { name: 'Import data?' }).getByRole('button', { name: 'Replace data' }).click()

    // Replaced with empty → the scheduler shows its empty state.
    await expect(page.getByTestId('scheduler-empty')).toBeVisible()

    // Undo brings the seeded data back.
    await page.keyboard.press('Meta+z')
    await expect(page.getByText('Tyler Nix')).toBeVisible()
  })

  test('rejects a non-Floaty file with a notice and preserves existing data', async ({ page }) => {
    await page.goto('/')
    await importFile(page, 'random.json', JSON.stringify({ hello: 'world' }))

    await expect(page.getByRole('alert')).toContainText(/not valid Floaty JSON/i)
    await expect(page.getByText('Tyler Nix')).toBeVisible() // data preserved, no dialog, no wipe
  })
})
