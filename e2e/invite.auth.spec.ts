import { test, expect } from './fixtures';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

// Invitations are emailed, and the E2E servers have no mail transport, so the emailed journey is
// covered by the server functional tests. The bootstrap link in first-company.auth.spec exercises
// the same acceptance page against a real server.
test.describe('invitation page', () => {
  test('an unknown link explains that the invitation is invalid', async ({ page }) => {
    await page.goto('/invite/not-a-real-invitation');
    await expect(page.getByRole('heading', { name: 'Accept invite' })).toBeVisible();
    await expect(page.getByTestId('invite-error')).toContainText(
      'This invitation is invalid or has expired',
    );
    await expect(page.getByTestId('invite-password')).toHaveCount(0);
  });

  test('a maximum-length address wraps within a narrow invitation page', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1000 });
    const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.test`;
    await page.route('**/api/invites/*/preview', (route) =>
      route.fulfill({
        json: { accountId: 'a-studio', accountName: 'Wayne Enterprises', role: 'editor', email },
      }),
    );
    await page.goto('/invite/long-address-layout');
    await expect(page.getByTestId('invite-role')).toHaveText('Editor');
    await expect(page.getByText(email)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });
});
