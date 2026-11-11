import { test, expect } from './dbFixtures';
import { openApp } from './browserTestSupport';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

// This suite leaves build SHA and feedback address unset, so both optional surfaces must be absent.

test.describe('Diagnostics build stamp + feedback link', () => {
  test('no build stamp in the default dev build', async ({ page }) => {
    await openApp(page, '/diagnostics');
    await expect(page.getByTestId('diagnostics-report-text')).toBeVisible();
    await expect(page.getByTestId('build-stamp')).toHaveCount(0);
  });

  test('no Send feedback link in the default dev build', async ({ page }) => {
    await openApp(page, '/diagnostics');
    await expect(page.getByTestId('diagnostics-report-text')).toBeVisible();
    await expect(page.getByTestId('send-feedback')).toHaveCount(0);
  });
});
