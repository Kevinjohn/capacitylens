import { test, expect } from './dbFixtures';
import type { Page } from './dbFixtures';
import {
  enableInlineActivityCreation,
  openApp,
  selectShadOption,
  setZoom,
} from './browserTestSupport';

// Covers US-SCH-09: the grid draws the server's per-day over-capacity flags. Which days are over is
// the server's rule (apps/backend/tests/unit/planning/capacity_section.spec.ts); this spec checks
// that a change which makes days over draws their markers.
//
// Seed bars live 1–9 June 2026 (clock frozen to 2026-06-03), so a fresh allocation Fri 12 → Mon 15
// June (spanning the empty weekend 13–14) collides with nothing. Clark Kent is Mon–Fri.
// The spec drives the modal in the seed's default hourly scheduling mode (Start/End + Hours / day).
const clarkLane = (page: Page) => page.locator('[data-resource-id="r-nike"]');
const clarkOverMarkers = (page: Page) => clarkLane(page).getByTestId('over-marker');

async function openScheduleWithInlineActivityCreation(page: Page) {
  await openApp(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await enableInlineActivityCreation(page);
  await page.getByRole('link', { name: 'Schedule' }).click();
  await setZoom(page, 2);
}

test.describe('Weekend over-marker', { tag: '@engine' }, () => {
  test('draws the over-capacity markers the server reports', async ({ page }) => {
    await openScheduleWithInlineActivityCreation(page);

    await expect(clarkOverMarkers(page)).toHaveCount(0);
    const baseline = 0;

    await page.getByRole('button', { name: 'Add allocation for Clark Kent' }).click();
    const create = page.getByRole('dialog', { name: 'New allocation' });
    await selectShadOption(create.getByLabel('Project', { exact: true }), 'p-acme');
    await create.getByLabel('New activity name').fill('Weekend Verify');
    await create.getByRole('button', { name: 'Add activity' }).click();
    await create.getByLabel(/^Start/).fill('2026-06-12');
    await create.getByLabel(/^End/).fill('2026-06-15');
    // The 8-hour allocation matches Clark's daily capacity, so working days should not be over capacity.
    await selectShadOption(create.getByRole('combobox', { name: 'Hours / day' }), '8');
    await page.getByRole('button', { name: 'Save' }).click();

    const bar = page.getByTestId('allocation-bar').filter({ hasText: 'Weekend Verify' });
    await expect(bar).toBeVisible();

    await expect(clarkOverMarkers(page)).toHaveCount(baseline);

    // Ignore the personal working pattern → the two weekend days now carry work against 0 capacity → over.
    await bar.click();
    const edit = page.getByRole('dialog', { name: 'Edit allocation' });
    await edit.getByRole('checkbox', { name: 'Ignore working days' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    // The save reply carries the advisory; the notice shows it after the dialog closes.
    await expect(edit).toBeHidden();
    await expect(
      page.getByText('Saved. This allocation is over capacity on 2 days.'),
    ).toBeVisible();
    await expect(clarkOverMarkers(page)).toHaveCount(baseline + 2);
  });
});
