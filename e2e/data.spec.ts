import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

const EMPTY_CAPACITYLENS = JSON.stringify({
  schemaVersion: 2,
  data: { disciplines: [], resources: [], clients: [], projects: [], phases: [], activities: [], allocations: [], timeOff: [] },
})

// A real (non-empty) import: one resource. Importing nothing is now refused (it would
// silently wipe the account), so the confirm/replace flow is exercised with actual data.
const NONEMPTY_CAPACITYLENS = JSON.stringify({
  schemaVersion: 2,
  data: {
    disciplines: [],
    clients: [],
    projects: [],
    phases: [],
    activities: [],
    allocations: [],
    timeOff: [],
    resources: [
      { id: 'imp-r', accountId: 'X', createdAt: 't', updatedAt: 't', kind: 'person', name: 'Imported Person', role: 'Designer', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#3b82f6' },
    ],
  },
})

const importFile = (page: import('@playwright/test').Page, name: string, body: string) =>
  page.getByTestId('import-input').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(body) })

// Covers US-DAT-02..04 and the canonical demo seed. Export round-trip and reset-on-reload
// are covered in e2e/crud.spec.ts; server persistence lives in persistence.db.spec.ts.
test.describe('Data import/export', () => {
  test('seeds a demo dataset on first load', async ({ page }) => {
    await openApp(page)
    await expect(page.getByText('Tyler Nix')).toBeVisible()
  })

  test('import shows a confirmation that replaces all data; Cancel keeps the data', async ({ page }) => {
    await openApp(page)
    await importFile(page, 'incoming.json', NONEMPTY_CAPACITYLENS)

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
    await importFile(page, 'incoming.json', NONEMPTY_CAPACITYLENS)
    await page.getByRole('dialog', { name: 'Import data?' }).getByRole('button', { name: 'Replace data' }).click()

    // Replaced → the imported resource shows and the seeded data is gone.
    await expect(page.getByText('Imported Person')).toBeVisible()
    await expect(page.getByText('Tyler Nix')).toHaveCount(0)

    // Undo brings the seeded data back.
    await page.keyboard.press('Meta+z')
    await expect(page.getByText('Tyler Nix')).toBeVisible()
  })

  test('rejects a non-CapacityLens file with a notice and preserves existing data', async ({ page }) => {
    await openApp(page)
    await importFile(page, 'random.json', JSON.stringify({ hello: 'world' }))

    // Surfaces the SPECIFIC reason from parseData (a JSON object with no CapacityLens keys), not a generic
    // catch-all. Shown via a Sonner error toast now (was the hand-rolled Toast's role="alert");
    // assert on the message text, which is Sonner-DOM-agnostic.
    await expect(page.getByText(/not CapacityLens data/i)).toBeVisible()
    await expect(page.getByText('Tyler Nix')).toBeVisible() // data preserved, no dialog, no wipe
  })

  test('rejects an EMPTY CapacityLens file (would silently wipe the account) with a notice', async ({ page }) => {
    await openApp(page)
    await importFile(page, 'empty.json', EMPTY_CAPACITYLENS)

    // No confirmation dialog, an error notice naming the specific reason (a CapacityLens-shaped but
    // empty file → would silently wipe the account), and the seeded data is preserved. The notice
    // is a Sonner error toast now; assert on its message text (Sonner-DOM-agnostic).
    await expect(page.getByText(/no CapacityLens records/i)).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Import data?' })).toHaveCount(0)
    await expect(page.getByText('Tyler Nix')).toBeVisible()
  })
})
