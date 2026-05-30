import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { openApp } from './helpers'

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

// Disable entrance animations so axe samples settled colours (mid-fade reads as
// false low-contrast). The app honours prefers-reduced-motion.
test.use({ reducedMotion: 'reduce' })

// Axe is the a11y oracle: getByRole proves an attribute exists, not that the
// structure/contrast is valid. This guards the whole a11y pass against regressions.
test('scheduler has no serious or critical accessibility violations', async ({ page }) => {
  await openApp(page)
  await expect(page.getByTestId('scheduler-grid')).toBeVisible()
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})

test('scheduler in dark mode has no serious or critical violations', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await openApp(page)
  await expect(page.getByTestId('scheduler-grid')).toBeVisible()
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})

test('a resource form modal has no serious or critical violations', async ({ page }) => {
  await openApp(page, 'Studio North', '/resources')
  await page.getByRole('button', { name: 'Add resource' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForTimeout(350) // let the entrance animation settle (mid-fade colours read as false low-contrast)
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})
