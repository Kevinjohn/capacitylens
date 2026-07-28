import { expect, test } from './fixtures'

test.use({ javaScriptEnabled: false })

test('JavaScript-disabled fallback replaces loading with one structured explanation', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'CapacityLens requires JavaScript' })).toBeVisible()
  await expect(page.getByText('Loading…')).toBeHidden()
  await expect(page.getByText(/JavaScript is disabled/)).toHaveCount(1)
})
