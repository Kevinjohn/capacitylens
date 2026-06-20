import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-NAV-01, 02, 06. (Loading gate, persist-error banner, toast and error
// boundary are covered by unit tests / manual scripts — impractical to trigger reliably in E2E.)
test.describe('Navigation & shell', () => {
  test('sidebar links route to each section', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()

    const sections: [string, () => Promise<void>][] = [
      ['Resources', async () => void (await expect(page.getByRole('button', { name: 'Add resource' })).toBeVisible())],
      ['Disciplines', async () => void (await expect(page.getByRole('button', { name: 'Add discipline' })).toBeVisible())],
      ['Clients', async () => void (await expect(page.getByRole('button', { name: 'Add client' })).toBeVisible())],
      ['Projects', async () => void (await expect(page.getByRole('button', { name: 'Add project' })).toBeVisible())],
      ['Activities', async () => void (await expect(page.getByRole('button', { name: 'Add activity' })).toBeVisible())],
      ['Time off', async () => void (await expect(page.getByRole('button', { name: 'Add time off' })).toBeVisible())],
      ['Settings', async () => void (await expect(page.getByLabel('Company name')).toBeVisible())],
    ]
    for (const [link, assert] of sections) {
      await page.getByRole('link', { name: link, exact: true }).click()
      await assert()
    }
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()
  })

  test('settings toggles the colour theme', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    // Light is the default preference.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')

    await page.getByRole('radio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await page.getByRole('radio', { name: 'Light' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  test('the active section is marked aria-current', async ({ page }) => {
    await openApp(page)
    await page.getByRole('link', { name: 'Resources' }).click()
    await expect(page.getByRole('link', { name: 'Resources' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('link', { name: 'Clients' })).not.toHaveAttribute('aria-current', 'page')
  })

  test('renders in dark mode', async ({ page }) => {
    // Dark is now an explicit preference, not OS-driven: seed the stored theme so
    // the pre-paint script in index.html resolves the app to dark.
    await page.addInitScript(() => localStorage.setItem('floaty/theme', 'dark'))
    await openApp(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()
    await expect(page.getByText('Tyler Nix')).toBeVisible()
  })
})
