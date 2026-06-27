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

  // WCAG 2.4.2 (Page Titled): each route sets a descriptive document.title of "<nav label> · CapacityLens",
  // derived from the SAME nav labels — so the tab/history/bookmark differs per page rather than the
  // static "CapacityLens" index.html sets. Assert a couple of routes are distinct AND descriptive.
  test('each route sets a descriptive, distinct document.title', async ({ page }) => {
    await openApp(page)
    // The index route reads as the scheduler's nav label, not the bare brand.
    await expect(page).toHaveTitle('Schedule · CapacityLens')

    await page.getByRole('link', { name: 'Resources', exact: true }).click()
    await expect(page).toHaveTitle('Resources · CapacityLens')

    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(page).toHaveTitle('Settings · CapacityLens')

    // Distinct from the static fallback and from each other (the bug was every route == "CapacityLens").
    await page.getByRole('link', { name: 'Schedule', exact: true }).click()
    await expect(page).toHaveTitle('Schedule · CapacityLens')
    await expect(page).not.toHaveTitle('CapacityLens')
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
    await page.addInitScript(() => localStorage.setItem('capacitylens/theme', 'dark'))
    await openApp(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()
    await expect(page.getByText('Tyler Nix')).toBeVisible()
  })

  // The sidebar collapse toggle's hover label is the shadcn Radix Tooltip (ui/tooltip.tsx),
  // not a native `title`. This runs cross-engine (e2e:browsers → Chromium/WebKit/Firefox) on
  // purpose: Radix Tooltip's hover behavior was the uncertainty that deferred this pass.
  test('the collapse toggle reveals its shadcn Tooltip on hover', async ({ page }) => {
    await openApp(page)
    // Desktop default = sidebar open, so the focusable toggle reads "Collapse menu" and
    // keeps that aria-label as its accessible name (the tooltip is supplementary).
    const toggle = page.getByRole('button', { name: 'Collapse menu' })
    await expect(toggle).toBeVisible()
    // Closed: Radix mounts the tooltip only while open, so there's no role=tooltip yet.
    await expect(page.getByRole('tooltip', { name: 'Collapse menu' })).toHaveCount(0)
    // Hover reveals it instantly (the provider uses delayDuration 0). This is the cross-engine
    // behavior the pass was deferred over; the toggle's aria-label stays its accessible name.
    await toggle.hover()
    await expect(page.getByRole('tooltip', { name: 'Collapse menu' })).toBeVisible()
  })
})
