import { test, expect, type Page } from '@playwright/test'
import { openApp } from './helpers'

test.use({ reducedMotion: 'reduce' })

// First-run "Getting started" checklist + "Show me around" tour (US-NAV-13). The card is
// state-driven: it shows only while the ACTIVE account still has an onboarding step to do, so the
// seeded companies (full data) never show it — these specs create a FRESH empty company (same
// picker flow as onboarding.spec.ts) to see it. Dismissal is the device-global
// `capacitylens/gettingStartedDismissed` pref, mirroring the intro page's flag.

const FIXED_NOW = new Date('2026-06-03T12:00:00')

/** Land in a brand-new empty company (through the fake-sign-in, picker create form, and intro
 *  gates), where the checklist has every step still to do. */
async function openEmptyCompany(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW)
  await page.goto('/')
  const signIn = page.getByTestId('fake-sign-in')
  const newCompany = page.getByRole('button', { name: 'New company' })
  await signIn.or(newCompany).first().waitFor()
  if (await signIn.isVisible()) await signIn.click()
  await newCompany.click()
  await page.getByLabel('Company name').fill('Fresh Co')
  await page.getByRole('button', { name: 'Create company' }).click()
  const introContinue = page.getByTestId('intro-continue')
  const appMain = page.locator('#main')
  await introContinue.or(appMain).first().waitFor()
  if (await introContinue.isVisible()) await introContinue.click()
  await expect(appMain).toBeVisible()
}

test.describe('getting started checklist', () => {
  test('a seeded (fully set up) company never shows the card', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('scheduler-grid')).toBeVisible()
    await expect(page.getByTestId('getting-started')).toHaveCount(0)
  })

  test('an empty company shows the card; completing a step ticks it off', async ({ page }) => {
    await openEmptyCompany(page)
    const card = page.getByTestId('getting-started')
    await expect(card).toBeVisible()

    // All four steps are pending — the first three are links to where the step happens.
    // (The account's built-in Internal client must NOT tick the client step.)
    const clientStep = card.getByRole('link', { name: 'Add your first client' })
    await expect(clientStep).toBeVisible()
    await expect(card.getByRole('link', { name: 'Add your first project' })).toBeVisible()
    await expect(card.getByRole('link', { name: 'Add your first person' })).toBeVisible()
    await expect(card.getByText('Assign them to the project')).toBeVisible()

    // Follow the first step and actually add a client…
    await clientStep.click()
    await expect(page).toHaveURL(/\/clients$/)
    await page.getByRole('button', { name: 'Add client' }).click()
    await page.getByLabel('Name').fill('Acme')
    await page.getByRole('button', { name: 'Save' }).click()

    // …then back on the schedule the client step is done (no longer a link) and the rest remain.
    await page.getByRole('link', { name: 'Schedule' }).click()
    await expect(card).toBeVisible()
    await expect(card.getByRole('link', { name: 'Add your first client' })).toHaveCount(0)
    await expect(card.getByText('Add your first client')).toBeVisible()
    await expect(card.getByRole('link', { name: 'Add your first project' })).toBeVisible()
  })

  test('"Show me around" runs the loose orientation tour', async ({ page }) => {
    await openEmptyCompany(page)
    await page.getByTestId('getting-started-tour').click()

    // Stop 1: the schedule grid. The tour never navigates — URL stays on the schedule throughout.
    const popover = page.locator('.driver-popover')
    await expect(popover).toBeVisible()
    await expect(popover.getByText('The schedule')).toBeVisible()

    await popover.getByRole('button', { name: 'Next' }).click()
    await expect(popover.getByText('Search, filters and zoom')).toBeVisible()

    await popover.getByRole('button', { name: 'Next' }).click()
    await expect(popover.getByText('People', { exact: true })).toBeVisible()

    // Escape bails out of the tour without side effects; the checklist card is still there.
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
    await expect(page.getByTestId('getting-started')).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
  })

  test('Dismiss hides the card and persists the device-global flag', async ({ page }) => {
    await openEmptyCompany(page)
    await page.getByTestId('getting-started-dismiss').click()
    await expect(page.getByTestId('getting-started')).toHaveCount(0)
    const stored = await page.evaluate(() => localStorage.getItem('capacitylens/gettingStartedDismissed'))
    expect(stored).toBe('on')
  })
})
