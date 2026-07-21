import { test, expect } from '@playwright/test'
import { openApp, selectShadOption } from './helpers'

// Covers US-TOF-01..04.
test.describe('Time off', () => {
  test('books time off and shows it as a labelled block on the schedule', async ({ page }) => {
    await openApp(page, 'Studio North', '/timeoff')
    await page.getByRole('button', { name: 'Add time off' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add time off' })
    await selectShadOption(dialog.getByLabel('Resource'), { label: 'Nike Spiros' })
    await dialog.getByLabel('Start').fill('2026-06-17')
    await dialog.getByLabel('End').fill('2026-06-19')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByTestId('timeoff-row').filter({ hasText: 'Nike Spiros' })).toBeVisible()

    // It renders as a labelled block on Nike's lane.
    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('radio', { name: '4w', exact: true }).click()
    await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
    await expect(page.locator('[data-resource-id="r-nike"]').getByTestId('timeoff-block')).toBeVisible()
  })

  test('keeps the list row terse (start date + day count); the type label stays on the timeline', async ({ page }) => {
    await openApp(page, 'Studio North', '/timeoff')
    const row = page.getByTestId('timeoff-row').filter({ hasText: 'Tyler Nix' })
    // The list row is intentionally terse: the start date and how many days — no end date, no type.
    // (Seed: Tyler off 10–12 June, starting a Wednesday, three inclusive days.)
    await expect(row).toContainText('Wed 10th Jun')
    await expect(row).toContainText('3 days')
    await expect(row).not.toContainText('Holiday')

    // The readable type label still lives on the timeline block (zoom 1w so the label renders).
    await page.getByRole('link', { name: 'Schedule' }).click()
    await page.getByRole('radio', { name: '1w', exact: true }).click()
    await page.getByLabel('Jump to date').fill('2026-06-01')
    const block = page.locator('[data-resource-id="r-tyler"]').getByTestId('timeoff-block')
    await expect(block).toContainText('Holiday') // the human label…
    await expect(block).not.toContainText('holiday') // …not the raw enum
  })

  test('edits a time-off entry and the list reflects the change', async ({ page }) => {
    await openApp(page, 'Studio North', '/timeoff')
    const row = page.getByTestId('timeoff-row').filter({ hasText: 'Tyler Nix' })
    await row.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit time off' })
    await selectShadOption(dialog.getByLabel('Type'), { label: 'Sick' })
    // exact: the seed entry's Note ("Long weekend") otherwise substring-matches "End".
    await dialog.getByLabel(/^End/).fill('2026-06-11') // shorten 12 June → 11 June
    await page.getByRole('button', { name: 'Save' }).click()

    // The list shows the start date + day count, so shortening the end reflects as a smaller count.
    await expect(row).toContainText('Wed 10th Jun') // start unchanged
    await expect(row).toContainText('2 days') // was 3 days
    await expect(row).not.toContainText('3 days')

    // The type change persisted too — reopen the editor to confirm (the type isn't in the list).
    await row.getByRole('button', { name: 'Edit' }).click()
    await expect(page.getByRole('dialog', { name: 'Edit time off' }).getByLabel('Type')).toHaveText('Sick')
  })

  test('deletes a time-off entry after confirmation and restores it with undo', async ({ page }) => {
    await openApp(page, 'Studio North', '/timeoff')
    await page.getByTestId('timeoff-row').filter({ hasText: 'Tyler Nix' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('alertdialog', { name: 'Delete time off?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('timeoff-row')).toHaveCount(0)

    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('timeoff-row').filter({ hasText: 'Tyler Nix' })).toBeVisible()
  })
})
