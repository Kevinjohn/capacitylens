import { expect, test } from './dbFixtures';
import type { APIRequestContext, Page } from './dbFixtures';
import { openApp } from './browserTestKit';
import { API } from './serverTestState';

type Availability = {
  id: string;
  firstAvailableDate: string | null;
  lastAvailableDate: string | null;
};

async function persistedAvailability(request: APIRequestContext): Promise<Availability> {
  const response = await request.get(`${API}/api/v1/state?companyId=a-studio&includeInactive=1`);
  expect(response.status()).toBe(200);
  const state = ((await response.json()) as { data: { resources: Availability[] } }).data;
  const resource = state.resources.find(({ id }) => id === 'r-tyler');
  if (!resource) throw new Error('The seeded person must survive availability edits');
  expect(resource).toHaveProperty('firstAvailableDate');
  expect(resource).toHaveProperty('lastAvailableDate');
  return resource;
}

async function saveAvailability(page: Page, first: string, last: string): Promise<void> {
  const row = page.getByTestId('resource-row').filter({ hasText: 'Bruce Wayne' });
  await row.getByRole('button', { name: 'Edit Bruce Wayne' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit resource' });
  await dialog.getByLabel('Start date', { exact: true }).fill(first);
  await dialog.getByLabel('End date', { exact: true }).fill(last);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test(
  'clearing, saving and reloading availability keeps explicit null values',
  { tag: '@engine' },
  async ({ page, request }) => {
    await openApp(page, '/resources');
    await saveAvailability(page, '2026-06-01', '2026-06-30');
    await expect
      .poll(async () => {
        const row = await persistedAvailability(request);
        return [row.firstAvailableDate, row.lastAvailableDate];
      })
      .toEqual(['2026-06-01', '2026-06-30']);

    await saveAvailability(page, '', '');
    await expect
      .poll(async () => {
        const row = await persistedAvailability(request);
        return [row.firstAvailableDate, row.lastAvailableDate];
      })
      .toEqual([null, null]);
    await openApp(page, '/resources');
    await saveAvailability(page, '2026-06-05', '2026-06-25');
    await expect
      .poll(async () => {
        const row = await persistedAvailability(request);
        return [row.firstAvailableDate, row.lastAvailableDate];
      })
      .toEqual(['2026-06-05', '2026-06-25']);

    // Resource availability is a typed planning write and can be undone without losing nulls.
    await page.getByRole('link', { name: 'Schedule', exact: true }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => {
        const row = await persistedAvailability(request);
        return [row.firstAvailableDate, row.lastAvailableDate];
      })
      .toEqual([null, null]);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect
      .poll(async () => {
        const row = await persistedAvailability(request);
        return [row.firstAvailableDate, row.lastAvailableDate];
      })
      .toEqual(['2026-06-05', '2026-06-25']);
    // The server holds the redone value before the page has read it back; a save sent in that gap is refused.
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    await page.getByRole('link', { name: 'Resources', exact: true }).click();
    await saveAvailability(page, '', '');
    await expect
      .poll(async () => {
        const row = await persistedAvailability(request);
        return [row.firstAvailableDate, row.lastAvailableDate];
      })
      .toEqual([null, null]);
    await openApp(page, '/resources');
    await page
      .getByTestId('resource-row')
      .filter({ hasText: 'Bruce Wayne' })
      .getByRole('button', { name: 'Edit Bruce Wayne' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Edit resource' });
    await expect(dialog.getByLabel('Start date', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('End date', { exact: true })).toHaveValue('');
  },
);
