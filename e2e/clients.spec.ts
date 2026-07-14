import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-CLI-01..03.
test.describe('Clients', () => {
  test('adds a client and makes it available as a schedule filter', async ({ page }) => {
    await openApp(page, 'Studio North', '/clients')
    await page.getByRole('button', { name: 'Add client' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Initech')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('client-row').filter({ hasText: 'Initech' })).toBeVisible()

    // Available as a client filter on the schedule.
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByLabel('Filter by client').getByRole('option', { name: 'Initech' })).toBeAttached()
  })

  test('an owner can add a private client with a code name', async ({ page }) => {
    await openApp(page, 'Studio North', '/clients')
    await page.getByRole('button', { name: 'Add client' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Embargoed Client Ltd')
    await page.getByRole('switch', { name: 'Use a code name' }).click()
    await page.getByRole('textbox', { name: 'Code name', exact: true }).fill('""')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText(/name is required/i)
    await expect(page.getByRole('dialog', { name: 'Add client' })).toBeVisible()

    await page.getByRole('textbox', { name: 'Code name', exact: true }).fill('"Northstar"')
    await page.getByRole('button', { name: 'Save' }).click()

    const row = page.getByTestId('client-row').filter({ hasText: 'Embargoed Client Ltd' })
    await expect(row).toBeVisible() // trusted-local/demo is owner-equivalent and sees the real name.
    await row.getByRole('button', { name: 'Edit' }).click()
    await expect(page.getByRole('switch', { name: 'Use a code name' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('textbox', { name: 'Code name', exact: true })).toHaveValue('Northstar')
  })

  test('rejects emoji / junk characters in a name and blocks the save', async ({ page }) => {
    await openApp(page, 'Studio North', '/clients')
    await page.getByRole('button', { name: 'Add client' }).click()
    // An emoji is rejected…
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Acme \u{1F389} Co')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText(/emoji or special characters/i)
    await expect(page.getByRole('dialog')).toBeVisible() // dialog stays open; nothing added
    // …a real accented name saves fine.
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Café Crème')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('client-row').filter({ hasText: 'Café Crème' })).toBeVisible()
  })

  test('edits a client and the rename reflects in project labels', async ({ page }) => {
    await openApp(page, 'Studio North', '/clients')
    await page.getByTestId('client-row').filter({ hasText: 'Acme Inc.' }).getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Acme Worldwide')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('client-row').filter({ hasText: 'Acme Worldwide' })).toBeVisible()

    // Project labels use "Client / Project".
    await page.getByRole('link', { name: 'Activities' }).click()
    await page.getByRole('button', { name: 'Add activity' }).click()
    await expect(page.getByLabel('Project').getByRole('option', { name: /Acme Worldwide \/ Project Lightning/ })).toBeAttached()
  })

  // P2.5b: the per-row destructive action ARCHIVES (hidden from the active list, fully retained — NOT
  // a hard cascade-delete). Its projects keep their OWN active status (archiving filters by each row's
  // own status, it does not cascade), so they stay visible; archiving is undoable via the local store.
  test('archiving a client hides it from the list, restorable with undo', async ({ page }) => {
    await openApp(page, 'Studio North', '/clients')
    await page.getByTestId('client-row').filter({ hasText: 'Acme Inc.' }).getByRole('button', { name: 'Archive Acme Inc.' }).click()
    await page.getByRole('dialog', { name: 'Archive client?' }).getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(page.getByTestId('client-row').filter({ hasText: 'Acme Inc.' })).toHaveCount(0)

    // Undo restores the archived client to the active list.
    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('client-row').filter({ hasText: 'Acme Inc.' })).toBeVisible()
  })
})
