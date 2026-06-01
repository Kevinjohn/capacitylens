import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

const EMPTY_FLOATY = JSON.stringify({
  schemaVersion: 2,
  data: { disciplines: [], resources: [], clients: [], projects: [], phases: [], tasks: [], allocations: [], timeOff: [] },
})

// A real (non-empty) import: one resource. Importing nothing is now refused (it would
// silently wipe the account), so the confirm/replace flow is exercised with actual data.
const NONEMPTY_FLOATY = JSON.stringify({
  schemaVersion: 2,
  data: {
    disciplines: [],
    clients: [],
    projects: [],
    phases: [],
    tasks: [],
    allocations: [],
    timeOff: [],
    resources: [
      { id: 'imp-r', accountId: 'X', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Imported Person', role: 'Designer', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#3b82f6' },
    ],
  },
})

const importFile = (page: import('@playwright/test').Page, name: string, body: string) =>
  page.getByTestId('import-input').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(body) })

// Covers US-DAT-02..04, 06. (Export round-trip + persist-across-reload + seed/no-reseed
// on a genuine wipe are covered in e2e/crud.spec.ts.)
test.describe('Data import/export', () => {
  test('seeds a demo dataset on first load', async ({ page }) => {
    await openApp(page)
    await expect(page.getByText('Tyler Nix')).toBeVisible()
  })

  test('import shows a confirmation that replaces all data; Cancel keeps the data', async ({ page }) => {
    await openApp(page)
    await importFile(page, 'incoming.json', NONEMPTY_FLOATY)

    const dialog = page.getByRole('dialog', { name: 'Import data?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(/replaces this company’s data/i)
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    // Data is untouched — the seeded resource is still there.
    await expect(page.getByText('Tyler Nix')).toBeVisible()
  })

  test('confirming an import replaces the dataset and ⌘Z restores it', async ({ page }) => {
    await openApp(page)
    await expect(page.getByText('Tyler Nix')).toBeVisible()
    await importFile(page, 'incoming.json', NONEMPTY_FLOATY)
    await page.getByRole('dialog', { name: 'Import data?' }).getByRole('button', { name: 'Replace data' }).click()

    // Replaced → the imported resource shows and the seeded data is gone.
    await expect(page.getByText('Imported Person')).toBeVisible()
    await expect(page.getByText('Tyler Nix')).toHaveCount(0)

    // Undo brings the seeded data back.
    await page.keyboard.press('Meta+z')
    await expect(page.getByText('Tyler Nix')).toBeVisible()
  })

  test('rejects a non-Floaty file with a notice and preserves existing data', async ({ page }) => {
    await openApp(page)
    await importFile(page, 'random.json', JSON.stringify({ hello: 'world' }))

    await expect(page.getByRole('alert')).toContainText(/not valid Floaty JSON/i)
    await expect(page.getByText('Tyler Nix')).toBeVisible() // data preserved, no dialog, no wipe
  })

  test('rejects an EMPTY Floaty file (would silently wipe the account) with a notice', async ({ page }) => {
    await openApp(page)
    await importFile(page, 'empty.json', EMPTY_FLOATY)

    // No confirmation dialog, an error notice, and the seeded data is preserved.
    await expect(page.getByRole('alert')).toContainText(/not valid Floaty JSON/i)
    await expect(page.getByRole('dialog', { name: 'Import data?' })).toHaveCount(0)
    await expect(page.getByText('Tyler Nix')).toBeVisible()
  })
})
