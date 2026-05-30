import { test, expect } from '@playwright/test'

// Covers US-NAV-01, 02, 06. (Loading gate, persist-error banner, toast and error
// boundary are covered by unit tests / manual scripts — impractical to trigger reliably in E2E.)
test.describe('Navigation & shell', () => {
  test('sidebar links route to each of the seven sections', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()

    const sections: [string, () => Promise<void>][] = [
      ['Resources', async () => void (await expect(page.getByRole('button', { name: 'Add resource' })).toBeVisible())],
      ['Disciplines', async () => void (await expect(page.getByRole('button', { name: 'Add discipline' })).toBeVisible())],
      ['Clients', async () => void (await expect(page.getByRole('button', { name: 'Add client' })).toBeVisible())],
      ['Projects', async () => void (await expect(page.getByRole('button', { name: 'Add project' })).toBeVisible())],
      ['Tasks', async () => void (await expect(page.getByRole('button', { name: 'Add task' })).toBeVisible())],
      ['Time off', async () => void (await expect(page.getByRole('button', { name: 'Add time off' })).toBeVisible())],
    ]
    for (const [link, assert] of sections) {
      await page.getByRole('link', { name: link, exact: true }).click()
      await assert()
    }
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()
  })

  test('the active section is marked aria-current', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Resources' }).click()
    await expect(page.getByRole('link', { name: 'Resources' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('link', { name: 'Clients' })).not.toHaveAttribute('aria-current', 'page')
  })

  test('renders in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/')
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()
    await expect(page.getByText('Tyler Nix')).toBeVisible()
  })
})
