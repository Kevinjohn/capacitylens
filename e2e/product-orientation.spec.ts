import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { freezeBrowserDate } from './browserTestSupport';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

// US-NAV-12: the demo opens on the company picker, and entering a company shows the non-blocking
// product orientation until Got it dismisses it.
test('picking a company shows guidance that can be dismissed and reopened from the sidebar', async ({
  page,
}) => {
  await freezeBrowserDate(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Choose a company' })).toBeVisible();
  await page.getByRole('button', { name: 'Wayne Enterprises', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'How CapacityLens works' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose a company' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Schedule' })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    blocking,
    JSON.stringify(
      blocking.map((v) => ({ id: v.id, nodes: v.nodes.length })),
      null,
      2,
    ),
  ).toEqual([]);

  // Dismissal removes the orientation itself; the surrounding app was already usable behind it,
  // so the schedule link is not evidence of the dismissal.
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByTestId('product-orientation')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'How CapacityLens works' })).toHaveCount(0);

  const reopen = page.getByRole('button', { name: 'How CapacityLens works', exact: true });
  await reopen.click();
  await expect(page.getByRole('heading', { name: 'How CapacityLens works' })).toBeFocused();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(reopen).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('dialog', { name: 'Best in landscape' })
    .getByRole('button', { name: 'Got it' })
    .click();

  // Open the mobile sidebar with its keyboard shortcut before clicking the persistent trigger.
  await page.keyboard.press('Control+b');
  await expect(page.getByRole('button', { name: 'Collapse menu' })).toBeVisible();
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page.getByRole('heading', { name: 'How CapacityLens works' })).toBeFocused();
  await page.getByRole('button', { name: 'Got it' }).click();
  const expandMenu = page.getByRole('button', { name: 'Expand menu' });
  await expect(page.getByTestId('product-orientation')).toHaveCount(0);
  await expect(expandMenu).toBeFocused();

  await expandMenu.click();
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page.getByRole('heading', { name: 'How CapacityLens works' })).toBeFocused();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByTestId('product-orientation')).toHaveCount(0);
  await expect(expandMenu).toBeFocused();
});
