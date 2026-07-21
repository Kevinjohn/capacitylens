import { test, expect } from '@playwright/test'
import { openApp } from './helpers'

// Covers US-SET-08 — the Settings "Clear device data" action.
// This spec deliberately does not confirm because confirmation reloads the page.
// We assert only that the button + confirm modal render with accurate copy, and that Cancel is a
// no-op. The actual clear + reload is exercised in the component test (SettingsView.test.tsx).
test.describe('Settings — Clear device data', () => {
  test('shows a destructive button + confirm modal; Cancel does not wipe', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')

    const button = page.getByTestId('clear-local-storage')
    await expect(button).toBeVisible()
    await expect(button).toHaveText('Clear device data')

    // Opening the modal shows the accurate, minimal copy (this browser + cannot be undone).
    await button.click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Clear device data?')
    await expect(dialog).toContainText(/THIS browser/i)
    await expect(dialog).toContainText(/cannot be undone/i)

    // Cancel closes the modal and leaves the app intact — the seeded data is untouched.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    // The button is still there (no reload happened) — proof Cancel was a no-op.
    await expect(page.getByTestId('clear-local-storage')).toBeVisible()
  })
})
