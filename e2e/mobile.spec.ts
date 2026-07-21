import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { openApp } from './helpers'

// Light mobile affordances: portrait phones use the ShadCN off-canvas Sidebar,
// compact landscape layouts use its icon mode, and portrait phones get a
// dismissable session-scoped "rotate to landscape" hint.
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
    // Settle first: hydration swaps the loading shell for the demo sign-in, which remounts
    // the hint. The modal makes that underlying screen inaccessible, so wait for its test id
    // to be attached rather than querying a hidden accessible role.
    await expect(page.getByTestId('fake-sign-in')).toBeAttached()
    const dialog = page.getByRole('dialog', { name: 'Best in landscape' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('opacity', '1')
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
  })

  test('opens the off-canvas sidebar and closes it after navigation', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('capacitylens/rotateHintDismissed', '1'))
    await openApp(page)

    const trigger = page.locator('[data-sidebar="trigger"]')
    await expect(trigger).toBeVisible()
    await trigger.click()

    const sidebar = page.getByRole('dialog', { name: 'Sidebar' })
    await expect(sidebar).toBeVisible()
    const collapse = sidebar.getByRole('button', { name: 'Collapse menu' })
    await expect(collapse).toBeVisible()
    await expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await sidebar.getByRole('link', { name: 'Projects' }).click()
    await expect(page).toHaveURL(/\/projects$/)
    await expect(sidebar).toBeHidden()
  })
})

test.describe('landscape phone', () => {
  test.use({ viewport: { width: 844, height: 390 } })

  test('sidebar starts in icon mode and its destinations still navigate', async ({ page }) => {
    await openApp(page)

    await expect(page.getByRole('dialog', { name: 'Best in landscape' })).toBeHidden()
    const projects = page.getByRole('link', { name: 'Projects' })
    await expect(projects).toBeVisible()
    await expect(page.getByTestId('app-sidebar')).toHaveAttribute('data-state', 'collapsed')
    await projects.click()
    await expect(page).toHaveURL(/\/projects$/)

    // Icon mode remains device-global after reload and account selection.
    await page.reload()
    await page.getByRole('button', { name: 'Studio North', exact: true }).click()
    await expect(page.getByTestId('app-sidebar')).toHaveAttribute('data-state', 'collapsed')
    await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible()
  })
})

test.describe('desktop', () => {
  test('sidebar is open by default, every nav link carries an icon, toggle collapses it', async ({ page }) => {
    await openApp(page)

    for (const name of ['Schedule', 'Resources', 'Team & access', 'Disciplines', 'Clients', 'Projects', 'Activities', 'Time off', 'Settings']) {
      const link = page.getByRole('link', { name, exact: true })
      await expect(link).toBeVisible()
      await expect(link.locator('svg')).toHaveCount(1)
    }

    const toggle = page.getByRole('button', { name: 'Collapse menu' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expect(page.getByTestId('app-sidebar')).toHaveAttribute('data-state', 'collapsed')
    await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Expand menu' })).toHaveAttribute('aria-expanded', 'false')
  })
})
