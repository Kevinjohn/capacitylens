import { test, expect } from './dbFixtures';

test('app boots into its authenticated company schedule', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('scheduler-grid')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose a company' })).toHaveCount(0);
  await expect(page).toHaveTitle(/CapacityLens/);
});
