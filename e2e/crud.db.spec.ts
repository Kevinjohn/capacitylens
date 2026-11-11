import { test, expect } from './dbFixtures';
import { openApp } from './browserTestSupport';

test.describe('CRUD and persistent company transfer', () => {
  test('a project cannot be saved without a client', async ({ page }) => {
    await openApp(page);
    await page.getByRole('link', { name: 'Projects' }).click();
    await page.getByRole('button', { name: 'Add project' }).click();

    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Clientless Project');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('alert')).toContainText(/must belong to a client/i);
  });

  test('adding a client persists across a reload', async ({ page }) => {
    await openApp(page);
    await page.getByRole('link', { name: 'Clients' }).click();
    await page.getByRole('button', { name: 'Add client' }).click();

    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Persisted Client');
    const committed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/accounts/a-studio/clients',
    );
    await page.getByRole('button', { name: 'Save' }).click();
    const response = await committed;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'committed' });

    await expect(page.getByText('Persisted Client')).toBeVisible();

    // A fresh document reads the committed company data from SQLite.
    await openApp(page);
    await page.getByRole('link', { name: 'Clients' }).click();
    await expect(page.getByText('Persisted Client')).toBeVisible();
  });

  test('exports the dataset and re-imports it (round-trip)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('link', { name: 'Clients' }).click();
    await page.getByRole('button', { name: 'Add client' }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('RoundTrip Co');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('RoundTrip Co')).toBeVisible();

    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Import and export', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-data').click();
    const file = await (await downloadPromise).path();

    // Change the exported row before restoring the exported company document.
    await page.getByRole('link', { name: 'Clients' }).click();
    const row = page.getByTestId('client-row').filter({ hasText: 'RoundTrip Co' });
    await row.getByRole('button', { name: 'Edit RoundTrip Co' }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Changed Company');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Changed Company')).toBeVisible();

    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Import and export', exact: true }).click();
    await page.getByTestId('import-input').setInputFiles(file);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Import data?' })).toBeVisible();
    await page.getByRole('button', { name: 'Replace data' }).click();
    await page.getByLabel('Password', { exact: true }).fill('auth-e2e-password-2026');
    await page.getByTestId('password-confirmation-submit').click();
    await page.getByRole('link', { name: 'Clients' }).click();
    await expect(page.getByText('RoundTrip Co')).toBeVisible();
  });
});
