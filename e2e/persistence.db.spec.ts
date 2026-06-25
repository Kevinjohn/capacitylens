import { test, expect } from '@playwright/test'
import { openApp } from './helpers'
import { resetServer, serverState } from './db-helpers'

// DB-backed E2E: this project's app is built with VITE_CAPACITYLENS_API, so persistence
// runs through the entity-level ServerSyncAdapter against the real SQLite server.
// Everything is driven through the same UI flows as the localStorage specs — the
// difference that matters is that a reload re-hydrates purely from GET /api/state
// (there is no localStorage fallback), so a surviving record proves a real server
// round-trip: UI → store → adapter → PUT/DELETE → SQLite → GET on reload.

const settle = (page: import('@playwright/test').Page) => page.waitForTimeout(600) // debounced save + network

test.describe('database-backed persistence', () => {
  test.beforeEach(async ({ request }) => {
    await resetServer(request, true) // wipe + re-seed before each test
  })

  test('hydrates the seeded dataset from the server on load', async ({ page }) => {
    await openApp(page) // picks "Studio North" from the server-seeded accounts
    // "Tyler Nix" is part of the server seed; seeing it proves GET /api/state → UI.
    await expect(page.getByText('Tyler Nix')).toBeVisible()
  })

  test('create + reload: a new client round-trips through the DB', async ({ page, request }) => {
    await openApp(page)
    await page.getByRole('link', { name: 'Clients' }).click()
    await page.getByRole('button', { name: 'Add client' }).click()
    await page.getByLabel('Name').fill('Persisted DB Co')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Persisted DB Co')).toBeVisible()

    // The write is debounced; confirm it actually reached the server tables.
    await expect
      .poll(async () => (await serverState(request)).clients.some((c) => c.name === 'Persisted DB Co'), {
        timeout: 10_000,
      })
      .toBe(true)

    // Reload re-hydrates from the DB (no localStorage). The client must still show.
    await openApp(page)
    await page.getByRole('link', { name: 'Clients' }).click()
    await expect(page.getByText('Persisted DB Co')).toBeVisible()
  })

  test('edit + reload: a rename round-trips through the DB', async ({ page }) => {
    await openApp(page)
    await page.getByRole('link', { name: 'Clients' }).click()
    await page.getByRole('button', { name: 'Add client' }).click()
    await page.getByLabel('Name').fill('Rename Me Co')
    await page.getByRole('button', { name: 'Save' }).click()
    const row = page.getByTestId('client-row').filter({ hasText: 'Rename Me Co' })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Name').fill('Renamed Co')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('client-row').filter({ hasText: 'Renamed Co' })).toBeVisible()
    await settle(page)

    await openApp(page)
    await page.getByRole('link', { name: 'Clients' }).click()
    await expect(page.getByTestId('client-row').filter({ hasText: 'Renamed Co' })).toBeVisible()
    await expect(page.getByTestId('client-row').filter({ hasText: 'Rename Me Co' })).toHaveCount(0)
  })

  test('delete + reload: a removed client stays gone', async ({ page, request }) => {
    await openApp(page)
    await page.getByRole('link', { name: 'Clients' }).click()
    await page.getByRole('button', { name: 'Add client' }).click()
    await page.getByLabel('Name').fill('Doomed Co')
    await page.getByRole('button', { name: 'Save' }).click()
    const row = page.getByTestId('client-row').filter({ hasText: 'Doomed Co' })
    await expect(row).toBeVisible()
    await settle(page)

    await row.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog', { name: 'Delete client?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByTestId('client-row').filter({ hasText: 'Doomed Co' })).toHaveCount(0)

    await expect
      .poll(async () => (await serverState(request)).clients.some((c) => c.name === 'Doomed Co'), {
        timeout: 10_000,
      })
      .toBe(false)

    await openApp(page)
    await page.getByRole('link', { name: 'Clients' }).click()
    await expect(page.getByTestId('client-row').filter({ hasText: 'Doomed Co' })).toHaveCount(0)
  })
})
