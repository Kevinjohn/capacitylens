import { test, expect } from './dbFixtures';
import { openApp } from './browserTestSupport';
import { serverState, requireStateRows } from './serverTestState';

// Reload reads the committed company date convention from SQLite.
test.describe('Settings — date format is account data', () => {
  test("the company's choice survives a reload", async ({ page, request }) => {
    await openApp(page, '/settings');
    await page.getByRole('radio', { name: 'Sep 9', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Sep 9', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Wait for the accepted write before testing the reload round trip.
    await expect
      .poll(
        async () =>
          requireStateRows(await serverState(request), 'accounts').some(
            (account) => (account as { dateStyle?: string }).dateStyle === 'month-day',
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    await page.reload();
    // The single-company server summary restores the company and the current Settings route.
    await expect(page.getByRole('heading', { name: 'Choose a company' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Switch company/i })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Sep 9', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

// Covers US-SET-17. The date-style preference (account-wide, default "day-month") governs how
// dates and ranges read across the app. This spec asserts the Settings control and one
// representative surface, the Time off list, whose weekday form reorders
// without losing its ordinal. Range collapsing itself is covered exhaustively in
// src/lib/dateDisplay.test.ts, so it is not re-asserted here through the browser.
test.describe('Settings — date style', () => {
  test("defaults to '9 Sep' and switching updates the control", async ({ page }) => {
    await openApp(page, '/settings');
    const dayMonth = page.getByRole('radio', { name: '9 Sep', exact: true });
    const monthDay = page.getByRole('radio', { name: 'Sep 9', exact: true });
    await expect(dayMonth).toHaveAttribute('aria-checked', 'true');
    await expect(monthDay).toHaveAttribute('aria-checked', 'false');

    await monthDay.click();
    await expect(monthDay).toHaveAttribute('aria-checked', 'true');
    await expect(dayMonth).toHaveAttribute('aria-checked', 'false');
  });

  test("switching to 'Sep 9' updates the Time off list's date reading", async ({ page }) => {
    await openApp(page, '/settings');
    await page.getByRole('radio', { name: 'Sep 9', exact: true }).click();

    await page.getByRole('link', { name: 'Time off' }).click();
    const row = page
      .getByTestId('timeoff-group')
      .filter({ has: page.getByRole('heading', { name: 'Bruce Wayne', exact: true }) })
      .getByTestId('timeoff-row')
      .first();
    await expect(row).toContainText('Wed Jun 10th');
  });

  test('reformats a collapsed range on the schedule', async ({ page }) => {
    await openApp(page, '/settings');
    await page.getByRole('radio', { name: 'Sep 9', exact: true }).click();

    await page.getByRole('link', { name: 'Schedule', exact: true }).click();
    await page.getByRole('button', { name: "View Bruce Wayne's schedule BW" }).click();
    const sheet = page.getByRole('dialog', { name: "Bruce Wayne's schedule" });
    // The header's range collapses the repeated month at both styles; only the order moves, so
    // this is the assertion that would catch a call site left on a hand-built range.
    // The browser date is frozen to 3 June 2026, so the schedule header should show a June range.
    // This checks the range formatter against the fixed date rather than the machine date.
    await expect(sheet.getByTestId('person-schedule-header')).toContainText(
      /Jun \d{1,2} – \d{1,2}/,
    );
    await expect(sheet.getByTestId('person-schedule-header')).not.toContainText(
      /\d{1,2} – \d{1,2} Jun/,
    );
  });
});
