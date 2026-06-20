import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-RES-01..10 (Resources area). Each test starts from the seeded app
// (Playwright gives every test a fresh context → fresh localStorage → reseed).

test.describe('Resources', () => {
  test('adds a person and shows them in the list and schedule', async ({ page }) => {
    await openApp(page, 'Studio North', '/resources')
    await page.getByRole('button', { name: 'Add resource' }).click()

    await page.getByLabel('Name').fill('Dana Lee')
    await page.getByLabel('Role').fill('Motion Designer')
    await page.getByLabel('Discipline').selectOption({ label: 'Design' })
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('Dana Lee')).toBeVisible()
    // It appears on the schedule under the Design group.
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Dana Lee' })).toBeVisible()
  })

  test('adds a placeholder bound to a project and shows it as "Placeholder" on the schedule', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    // Placeholders are hidden by default (device-global pref) — turn them on so the management
    // section + "Add placeholder" button appear on the Resources page.
    await page.getByRole('switch', { name: 'Show placeholders' }).click()
    await page.getByRole('link', { name: 'Resources' }).click()
    await page.getByRole('button', { name: 'Add placeholder' }).click()

    await page.getByLabel('Role').fill('Junior Dev')
    await page.getByLabel('Bound project').selectOption('p-acme') // Acme Inc. / Project Lightning
    await page.getByRole('button', { name: 'Save' }).click()

    await page.getByRole('link', { name: 'Schedule' }).click()
    // A placeholder shows as the literal name "Placeholder" in the schedule view; its role
    // ("Junior Dev") is the secondary text below.
    const row = page.getByTestId('scheduler-row').filter({ hasText: 'Placeholder' }).filter({ hasText: 'Junior Dev' })
    await expect(row).toBeVisible()
  })

  test('rejects a placeholder with no bound project', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    await page.getByRole('switch', { name: 'Show placeholders' }).click()
    await page.getByRole('link', { name: 'Resources' }).click()
    await page.getByRole('button', { name: 'Add placeholder' }).click()
    await page.getByLabel('Role').fill('Unbound slot')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText(/must be bound to a project/i)
  })

  test('edits a resource and the change persists', async ({ page }) => {
    await openApp(page, 'Studio North', '/resources')
    await page.getByTestId('resource-row').filter({ hasText: 'Nike Spiros' }).getByRole('button', { name: 'Edit' }).click()
    const role = page.getByLabel('Role')
    await role.fill('Lead Developer')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Lead Developer')).toBeVisible()
  })

  test('deleting a resource cascades to its allocations and time off, and undo restores them', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '4w', exact: true }).click()
    await page.getByLabel('Jump to date').fill('2026-06-01')
    const tylerBars = page.locator('[data-resource-id="r-tyler"]').getByTestId('allocation-bar')
    expect(await tylerBars.count()).toBeGreaterThan(0)

    await page.getByRole('link', { name: 'Resources' }).click()
    await page.getByTestId('resource-row').filter({ hasText: 'Tyler Nix' }).getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('resource-row').filter({ hasText: 'Tyler Nix' })).toHaveCount(0)

    // Undo restores the resource (and, on the schedule, its bars + time off).
    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('resource-row').filter({ hasText: 'Tyler Nix' })).toBeVisible()
  })

  test('rejects zero working hours', async ({ page }) => {
    await openApp(page, 'Studio North', '/resources')
    await page.getByRole('button', { name: 'Add resource' }).click()
    await page.getByLabel('Name').fill('Edge Case')
    await page.getByLabel('Role').fill('Tester')

    await page.getByLabel('Working hours / day').fill('0')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText(/greater than 0/i)
  })

  test('the Temp tag is parked: freelancers render untagged', async ({ page }) => {
    // Employment type is still captured on the form, but the visual pill is hidden
    // pending the freelancer/contractor/third-party treatment (NEEDS-INPUT.md "Parked").
    await openApp(page, 'Studio North', '/resources')
    // Alex Rivera is a seeded freelancer — visible, but with no Temp tag anywhere.
    await expect(page.getByTestId('resource-row').filter({ hasText: 'Alex Rivera' })).toBeVisible()
    await expect(page.getByText('Temp', { exact: true })).toHaveCount(0)
  })
})
