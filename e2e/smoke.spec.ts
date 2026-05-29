import { test, expect } from '@playwright/test'

test('app boots and mounts the React root', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#root')).toBeVisible()
})
