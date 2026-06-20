import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { openApp } from './helpers'

// Light mobile affordances (owner, 2026-06-12): the sidebar collapses to an icon
// rail (closed by default on small screens), rail icons only reopen the menu, and
// portrait phones get a dismissable session-scoped "rotate to landscape" hint.
// Full mobile workflows remain a non-goal — these specs cover the affordances only.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

test.describe('portrait phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('shows the rotate hint; dismissing it sticks for the session', async ({ page }) => {
    await page.goto('/')
    // The hint rides over the demo sign-in (a phone user's first contact) just as it does
    // the picker.
    const dialog = page.getByRole('dialog', { name: 'Best in landscape' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Got it' }).click()
    await expect(dialog).toBeHidden()

    // Click through the demo sign-in so a reload lands on the picker (the sign-in flag
    // persists; the session-scoped hint dismissal must still hold).
    await page.getByTestId('fake-sign-in').click()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Studio North', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Best in landscape' })).toBeHidden()
  })

  test('rotate hint has no serious or critical accessibility violations', async ({ page }) => {
    // Disable the dialog's entrance animation so axe samples settled colours, not a
    // mid-fade blend (same rationale as a11y.spec.ts). test.use({ reducedMotion })
    // did not apply in this describe-scoped setup — emulate explicitly instead.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    // Settle first: hydration swaps the loading shell for the demo sign-in (now the first
    // screen), which remounts the hint — sample the final mount, not a transitional one.
    // This also audits the demo sign-in screen itself for a11y violations.
    await expect(page.getByRole('heading', { name: 'Choose an account' })).toBeVisible()
    const dialog = page.getByRole('dialog', { name: 'Best in landscape' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('opacity', '1')
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
  })
})

test.describe('landscape phone', () => {
  test.use({ viewport: { width: 844, height: 390 } })

  test('sidebar starts collapsed; rail icons reopen the menu instead of navigating', async ({ page }) => {
    await openApp(page)

    // Collapsed by default on a small screen: icon rail, no nav links (the hint
    // itself stays hidden — landscape is the recommended orientation).
    await expect(page.getByRole('dialog', { name: 'Best in landscape' })).toBeHidden()
    await expect(page.getByRole('link', { name: 'Projects' })).toBeHidden()
    await expect(page.getByTestId('nav-rail-item')).toHaveCount(8)

    // A rail icon is not navigation: tapping "Projects" expands the menu, URL unchanged.
    await page.locator('[data-testid="nav-rail-item"][title="Projects"]').click()
    await expect(page).toHaveURL('/')
    const projects = page.getByRole('link', { name: 'Projects' })
    await expect(projects).toBeVisible()

    // The real link navigates as normal once the menu is open.
    await projects.click()
    await expect(page).toHaveURL(/\/projects$/)

    // Collapsing persists device-globally: still a rail after reload + re-pick.
    await page.getByRole('button', { name: 'Collapse menu' }).click()
    await expect(page.getByTestId('nav-rail-item')).toHaveCount(8)
    await page.reload()
    await page.getByRole('button', { name: 'Studio North', exact: true }).click()
    await expect(page.getByTestId('nav-rail-item')).toHaveCount(8)
    await expect(page.getByRole('link', { name: 'Projects' })).toBeHidden()
  })
})

test.describe('desktop', () => {
  test('sidebar is open by default, every nav link carries an icon, toggle collapses it', async ({ page }) => {
    await openApp(page)

    await expect(page.getByTestId('nav-rail-item')).toHaveCount(0)
    for (const name of ['Schedule', 'Resources', 'Disciplines', 'Clients', 'Projects', 'Activities', 'Time off', 'Settings']) {
      const link = page.getByRole('link', { name, exact: true })
      await expect(link).toBeVisible()
      await expect(link.locator('svg')).toHaveCount(1)
    }

    const toggle = page.getByRole('button', { name: 'Collapse menu' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expect(page.getByTestId('nav-rail-item')).toHaveCount(8)
    await expect(page.getByRole('button', { name: 'Expand menu' })).toHaveAttribute('aria-expanded', 'false')
  })
})
