import { test, expect } from './dbFixtures';
import type { Page } from './dbFixtures';
import { openApp, showScheduleFilters } from './browserTestSupport';

async function moveDianaToSupplementary(page: Page) {
  await page
    .getByTestId('resource-row')
    .filter({ hasText: 'Diana Prince' })
    .getByRole('button', { name: 'Edit Diana Prince' })
    .click();
  await page.getByRole('radio', { name: 'Supplementary' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
}

async function restoreDisciplines(page: Page) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Use disciplines' }).click();
  await expect(page.getByRole('link', { name: 'Disciplines' })).toBeVisible();
  await page.getByRole('link', { name: 'Schedule' }).click();
  await expect(page.getByTestId('discipline-group').first()).toBeVisible();
}

// The account-level "Use disciplines" toggle (Settings → Company features). Off should hide
// discipline surfaces and use engagement fallback bands on the schedule; on restores disciplines.
test('turning disciplines off hides every surface; turning it back on restores them', async ({
  page,
}) => {
  await openApp(page, '/resources');

  // Give the fallback a real Supplementary member before disabling disciplines so both engagement
  // bands are exercised in the browser, not just inferred from model tests.
  await moveDianaToSupplementary(page);

  // Enable External (default off) so its final band is present; it's an independent account pref.
  const showExternal = page.getByRole('switch', { name: 'Show external resources' });
  const showExternalCommitted = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      /\/api\/accounts\/[^/]+\/settings$/.test(new URL(response.url()).pathname),
  );
  await showExternal.click();
  await expect(showExternal).toHaveAttribute('aria-checked', 'true');
  const showExternalResponse = await showExternalCommitted;
  expect(showExternalResponse.status()).toBe(200);
  const showExternalReceipt = await showExternalResponse.json();
  expect(showExternalReceipt.status).toBe('committed');

  await expect(page.getByRole('link', { name: 'Disciplines' })).toBeVisible();
  const useDisciplines = page.getByRole('switch', { name: 'Use disciplines' });
  await expect(useDisciplines).toHaveAttribute('aria-checked', 'true');

  await useDisciplines.click();
  await expect(useDisciplines).toHaveAttribute('aria-checked', 'false');

  await expect(page.getByRole('link', { name: 'Disciplines' })).toHaveCount(0);

  // Collapsed navigation shows the same 10 destinations, including Diagnostics, without
  // Disciplines. External appears under Resources.
  await page.getByRole('button', { name: 'Collapse menu' }).click();
  await expect(page.getByTestId('app-sidebar')).toHaveAttribute('data-state', 'collapsed');
  await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(10);
  await expect(page.getByRole('link', { name: 'Disciplines' })).toHaveCount(0);
  await page.getByTestId('app-sidebar').getByRole('button', { name: 'Expand menu' }).click();

  await page.getByRole('link', { name: 'Schedule' }).click();
  await showScheduleFilters(page);
  await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Bruce Wayne' })).toBeVisible();
  const studio = page.getByTestId('discipline-group').filter({ hasText: 'Studio' });
  const supplementary = page.getByTestId('discipline-group').filter({ hasText: 'Supplementary' });
  await expect(studio).toBeVisible();
  await expect(supplementary).toBeVisible();
  await expect(studio).toContainText(/avg utilisation/);
  await expect(supplementary).toContainText(/avg utilisation/);

  const studioToggle = studio.getByRole('button');
  await studioToggle.click();
  await expect(studioToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Bruce Wayne' })).toHaveCount(0);
  await studioToggle.click();
  await expect(studioToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('scheduler-row').filter({ hasText: 'Bruce Wayne' })).toContainText(
    /utilisation/i,
  );

  // The External band is the last item; scroll to the bottom so it enters the virtualised window.
  await page.getByTestId('scheduler-grid').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.getByTestId('discipline-group').filter({ hasText: 'External / 3rd party' }),
  ).toBeVisible();
  await expect(page.getByLabel('Filter by discipline')).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('command-palette')).toBeVisible();
  await expect(
    page.getByTestId('command-palette-option').filter({ hasText: 'Disciplines' }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Resources' }).click();
  await page.getByRole('button', { name: 'Add resource' }).click();
  await expect(page.getByLabel('Discipline')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();

  // A fresh document must enforce the persisted route visibility preference.
  await page.goto('/disciplines');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('scheduler-grid')).toBeVisible();

  await restoreDisciplines(page);
});
