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
  // Dark is now an explicit preference (default is light), so seed the stored theme
  // rather than emulating the OS scheme — otherwise axe would sample the light palette.
  await page.addInitScript(() => localStorage.setItem('floaty/theme', 'dark'))
  await openApp(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('scheduler-grid')).toBeVisible()
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})

// Time-off draw mode recedes the work bars (dimmed neutral fill) and makes booked time-off
// glow. That re-skin must stay a11y-clean too: the receded bars and the amber glow are new
// colour treatments axe has never sampled. Studio North's seed carries one time-off block
// (Tyler Nix, 10-12 Jun); 4w + scrollLeft=0 brings both it and the work bars into view, the
// same way timeoff.spec proves the block renders.
async function openDrawMode(page: import('@playwright/test').Page): Promise<void> {
  await openApp(page)
  await expect(page.getByTestId('scheduler-grid')).toBeVisible()
  await page.getByRole('button', { name: '4w', exact: true }).click()
  await page.getByTestId('scheduler-grid').evaluate((el) => { (el as HTMLElement).scrollLeft = 0 })
  await page.getByRole('button', { name: 'Time off', exact: true }).click()
  await expect(page.getByTestId('scheduler-grid')).toHaveAttribute('data-draw-mode', 'timeoff')
  // The toggle's pressed fill cross-fades (0.15s); let it settle so axe samples the final
  // brand-strong + white pairing, not a mid-fade blend that reads as false low-contrast.
  await page.waitForTimeout(350)
  await expect(page.getByTestId('allocation-bar').first()).toBeVisible()
  await expect(page.locator('[data-resource-id="r-tyler"]').getByTestId('timeoff-block')).toBeVisible()
}

test('scheduler in time-off draw mode has no serious or critical violations', async ({ page }) => {
  await openDrawMode(page)
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([])
})

test('scheduler in time-off draw mode (dark) has no serious or critical violations', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('floaty/theme', 'dark'))
  await openDrawMode(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
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
