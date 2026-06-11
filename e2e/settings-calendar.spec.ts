import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { openApp } from './helpers'

test.use({ reducedMotion: 'reduce' })

test.describe('Calendar settings', () => {
  test('week-start and timezone controls are rendered with defaults', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')

    // Default is Monday — check the radio state
    const mondayBtn = page.getByRole('radio', { name: 'Monday' })
    const sundayBtn = page.getByRole('radio', { name: 'Sunday' })
    await expect(mondayBtn).toHaveAttribute('aria-checked', 'true')
    await expect(sundayBtn).toHaveAttribute('aria-checked', 'false')

    // Default timezone is GMT
    const tzSelect = page.getByLabel('Timezone')
    await expect(tzSelect).toBeVisible()
    await expect(tzSelect).toHaveValue('Etc/GMT')
  })

  test('week-start setting persists when switching to Sunday', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')

    const mondayBtn = page.getByRole('radio', { name: 'Monday' })
    const sundayBtn = page.getByRole('radio', { name: 'Sunday' })

    // Switch to Sunday
    await sundayBtn.click()
    await expect(sundayBtn).toHaveAttribute('aria-checked', 'true')
    await expect(mondayBtn).toHaveAttribute('aria-checked', 'false')
  })

  test('timezone setting can be changed', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    const tzSelect = page.getByLabel('Timezone')
    await tzSelect.selectOption('Europe/London')
    await expect(tzSelect).toHaveValue('Europe/London')
  })

  test('Settings page passes axe accessibility check', async ({ page }) => {
    await openApp(page, 'Studio North', '/settings')
    const results = await new AxeBuilder({ page }).analyze()
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(
      blocking,
      JSON.stringify(blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2),
    ).toEqual([])
  })
})
