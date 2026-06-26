import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// P2.5b — the DEFERRED P2.4 "archived vanishes" end-to-end story, now landable because the client
// admin UI (the Archive affordance + Settings → Archived & deleted) exists. LOCAL (localStorage /
// Chromium) mode: the default-deploy story, no auth server needed. The lifecycle store actions mutate
// the local blob, so archiving a row hides it from the scheduler + lists immediately and surfaces it
// in the admin view. Browser-agnostic — no UA branching.

const RESOURCE = 'Alex Rivera' // seed `r-alex` (a freelancer; no over-marker entanglement)

test.describe('Archived & deleted (local mode)', () => {
  test('archive a resource → it vanishes from the schedule + list → Settings shows it → restore → re-archive → delete → tombstone (purge locked)', async ({
    page,
  }) => {
    await openApp(page, 'Studio North', '/resources')

    // The seeded resource is in the list.
    const listRow = page.getByTestId('resource-row').filter({ hasText: RESOURCE })
    await expect(listRow).toBeVisible()

    // Archive it from the row (the old Delete affordance now ARCHIVES) → confirm dialog → Archive.
    await listRow.getByRole('button', { name: `Archive ${RESOURCE}` }).click()
    const archiveDialog = page.getByRole('dialog', { name: 'Archive resource?' })
    await expect(archiveDialog).toBeVisible()
    await archiveDialog.getByRole('button', { name: 'Archive', exact: true }).click()

    // GONE from the Resources list…
    await expect(page.getByTestId('resource-row').filter({ hasText: RESOURCE })).toHaveCount(0)
    // …and GONE from the schedule (no scheduler-row carries the name).
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByTestId('scheduler-row').filter({ hasText: RESOURCE })).toHaveCount(0)

    // Settings → Archived & deleted shows it as an archived row.
    await page.getByRole('link', { name: 'Settings' }).click()
    const section = page.getByTestId('archived-section')
    await expect(section).toBeVisible()
    const archivedRow = section.getByTestId('archived-row').filter({ hasText: RESOURCE })
    await expect(archivedRow).toBeVisible()

    // RESTORE → it reappears on the schedule + list.
    await archivedRow.getByRole('button', { name: `Restore ${RESOURCE}` }).click()
    await expect(section.getByTestId('archived-row').filter({ hasText: RESOURCE })).toHaveCount(0)
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByTestId('scheduler-row').filter({ hasText: RESOURCE })).toBeVisible()
    await page.getByRole('link', { name: 'Resources' }).click()
    await expect(page.getByTestId('resource-row').filter({ hasText: RESOURCE })).toBeVisible()

    // RE-ARCHIVE from the list.
    await page.getByTestId('resource-row').filter({ hasText: RESOURCE }).getByRole('button', { name: `Archive ${RESOURCE}` }).click()
    await page.getByRole('dialog', { name: 'Archive resource?' }).getByRole('button', { name: 'Archive', exact: true }).click()

    // In the admin view, DELETE (soft-delete) the archived row → confirm.
    await page.getByRole('link', { name: 'Settings' }).click()
    const section2 = page.getByTestId('archived-section')
    const archivedRow2 = section2.getByTestId('archived-row').filter({ hasText: RESOURCE })
    await expect(archivedRow2).toBeVisible()
    await archivedRow2.getByRole('button', { name: `Delete ${RESOURCE}` }).click()
    const deleteDialog = page.getByRole('dialog', { name: 'Delete this item?' })
    await expect(deleteDialog).toBeVisible()
    await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click()

    // It now shows as a TOMBSTONE with the obfuscated "Removed person #…" name (no original PII).
    const deletedRow = section2.getByTestId('deleted-row')
    await expect(deletedRow).toBeVisible()
    await expect(deletedRow).toHaveText(/Removed person #/)
    // The original name is gone everywhere in the admin view.
    await expect(section2.getByText(RESOURCE)).toHaveCount(0)

    // The Purge ("Delete permanently") button is DISABLED (the tombstone is "now", <30 days old) with
    // the locked hint.
    const purgeBtn = deletedRow.getByTestId('archived-purge')
    await expect(purgeBtn).toBeVisible()
    await expect(purgeBtn).toBeDisabled()
    await expect(deletedRow).toContainText('Can be permanently deleted 30 days after deletion')
  })
})
