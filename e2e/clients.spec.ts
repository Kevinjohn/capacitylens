import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-CLI-01..03.
test.describe('Clients', () => {
  test('adds a client and makes it available as a schedule filter', async ({ page }) => {
    await openApp(page, 'Studio North', '/clients')
    await page.getByRole('button', { name: 'Add client' }).click()
    await page.getByLabel('Name').fill('Initech')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('client-row').filter({ hasText: 'Initech' })).toBeVisible()

    // Available as a client filter on the schedule.
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByLabel('Filter by client').getByRole('option', { name: 'Initech' })).toBeAttached()
  })

  test('rejects emoji / junk characters in a name and blocks the save', async ({ page }) => {
    await openApp(page, 'Studio North', '/clients')
    await page.getByRole('button', { name: 'Add client' }).click()
    // An emoji is rejected…
    await page.getByLabel('Name').fill('Acme \u{1F389} Co')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText(/emoji or special characters/i)
    await expect(page.getByRole('dialog')).toBeVisible() // dialog stays open; nothing added
    // …a real accented name saves fine.
    await page.getByLabel('Name').fill('Café Crème')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('client-row').filter({ hasText: 'Café Crème' })).toBeVisible()
  })

  test('edits a client and the rename reflects in project labels', async ({ page }) => {
    await openApp(page, 'Studio North', '/clients')
    await page.getByTestId('client-row').filter({ hasText: 'Acme Inc.' }).getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Name').fill('Acme Worldwide')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('client-row').filter({ hasText: 'Acme Worldwide' })).toBeVisible()

    // Project labels use "Client / Project".
    await page.getByRole('link', { name: 'Tasks' }).click()
    await page.getByRole('button', { name: 'Add task' }).click()
    await expect(page.getByLabel('Project').getByRole('option', { name: /Acme Worldwide \/ Project Lightning/ })).toBeAttached()
  })

  test('deletes a client and cascades to its projects, restorable with undo', async ({ page }) => {
    await openApp(page, 'Studio North', '/clients')
    await page.getByTestId('client-row').filter({ hasText: 'Acme Inc.' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog', { name: 'Delete client?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('client-row').filter({ hasText: 'Acme Inc.' })).toHaveCount(0)

    // Its project is gone too.
    await page.getByRole('link', { name: 'Projects' }).click()
    await expect(page.getByTestId('project-row').filter({ hasText: 'Project Lightning' })).toHaveCount(0)

    // Undo restores client + project.
    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('project-row').filter({ hasText: 'Project Lightning' })).toBeVisible()
  })
})
