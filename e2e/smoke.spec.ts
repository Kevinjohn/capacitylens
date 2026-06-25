import { test, expect } from '@playwright/test'

test('app boots and mounts the React root', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#root')).toBeVisible()
  // Brand smoke (P0.0 rebrand): the document title carries the product name.
  await expect(page).toHaveTitle(/CapacityLens/)
})
