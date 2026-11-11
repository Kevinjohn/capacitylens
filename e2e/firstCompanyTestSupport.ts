import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { freezeBrowserDate, waitForAppLanding } from './browserTestSupport';
import { resetServer } from './serverTestState';

/** Opens first-install setup for the fixture's sole admitted identity. */
export async function openFirstCompanySetup(page: Page, request: APIRequestContext): Promise<void> {
  await resetServer({ request, withSeed: false });
  await freezeBrowserDate(page);
  await page.goto('/');
  await expect(page.getByTestId('company-setup')).toBeVisible();
}

/** Creates the installation's company and waits for its authenticated application shell. */
export async function finishFirstCompanySetup(page: Page, name: string): Promise<void> {
  await page.getByLabel('Company name').fill(name);
  await page.getByRole('button', { name: 'Create company', exact: true }).click();
  await waitForAppLanding(page, page.locator('#main'));
}
