import { test, expect } from './dbFixtures';
import { API, serverState, requireStateRows } from './serverTestState';
import { openFirstCompanySetup, finishFirstCompanySetup } from './firstCompanyTestSupport';
import { masqueradeContextHeaders } from './authTestSupport';

// The server rejects direct typed updates to frozen account fields. The read-only Settings summary
// is a convenience; server enforcement also applies when a client bypasses the UI.

test.describe('database-backed onboarding lock (P1.14)', () => {
  test('direct PATCHes of changeable frozen fields are rejected and unsupported language is rejected', async ({
    request,
  }) => {
    const before = await serverState(request);
    const account = requireStateRows(before, 'accounts')[0];
    if (account === undefined) throw new Error('Seeded server state must include an account');

    const changes = [
      ['weekStartsOn', 1, 0],
      ['timezone', 'UTC', 'Europe/London'],
    ] as const;
    let revision = 0;
    for (const [field, initial, target] of changes) {
      // The fixture deliberately models legacy accounts with these nullable settings unset.
      // Missing frozen fields may be initialized once; only a subsequent change is forbidden.
      const initialized = await request.patch(`${API}/api/accounts/${account.id}/settings`, {
        headers: await masqueradeContextHeaders(request, undefined, API),
        data: {
          mutationId: crypto.randomUUID(),
          baseRevision: revision,
          intent: { operation: 'settings.update', changes: { [field]: initial } },
        },
      });
      expect(initialized.status(), `${field} must allow one-time initialization`).toBe(200);
      revision += 1;

      const res = await request.patch(`${API}/api/accounts/${account.id}/settings`, {
        headers: await masqueradeContextHeaders(request, undefined, API),
        data: {
          mutationId: crypto.randomUUID(),
          baseRevision: revision,
          intent: { operation: 'settings.update', changes: { [field]: target } },
        },
      });
      expect(res.status(), `${field} must remain frozen`).toBe(409);
    }

    // English is currently the only supported language. A malformed choice is rejected
    // before frozen-field handling and cannot change stored account settings.
    const language = await request.patch(`${API}/api/accounts/${account.id}/settings`, {
      headers: await masqueradeContextHeaders(request, undefined, API),
      data: {
        mutationId: crypto.randomUUID(),
        baseRevision: revision,
        intent: { operation: 'settings.update', changes: { language: 'fr' } },
      },
    });
    expect(language.status()).toBe(400);

    const after = await serverState(request);
    const updatedAccount = requireStateRows(after, 'accounts')[0];
    if (updatedAccount === undefined)
      throw new Error('Server state must retain the seeded account');
    expect(updatedAccount.language).toBeNull();
    expect(updatedAccount).toMatchObject({
      weekStartsOn: 1,
      timezone: 'UTC',
    });
  });
});
// The E2E fixture contains one company. Production selects it from the server summary and exposes
// no company picker or switching controls.
test.describe('single-company production entry', () => {
  test('the server-selected company opens directly without a picker or switch control', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wayne Enterprises', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: /Switch company/i })).toHaveCount(0);
    await expect(page.getByTestId('new-company-button')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New company' })).toHaveCount(0);
  });

  test('ordinary additional company creation is rejected', async ({ request }) => {
    const res = await request.post(`${API}/api/orgs`, {
      headers: await masqueradeContextHeaders(request, undefined, API),
      data: {
        id: `e2e-cap-check-${Date.now()}`,
        name: 'Should Not Exist',
        color: '#76a5e7',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    expect(res.status()).toBe(404);

    const after = await serverState(request);
    expect(requireStateRows(after, 'accounts')).toHaveLength(1);
  });
});

// First-install setup captures the one company's fixed calendar convention.
test.describe('first-install calendar settings', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce', timezoneId: 'Europe/London' } });

  test('captures week start and time zone, then presents their read-only Settings summary', async ({
    page,
  }) => {
    await openFirstCompanySetup(page);
    await expect(page.getByLabel('Week starts on')).toHaveValue('1');
    const zone = page.getByLabel('Time zone', { exact: true });
    // Native first-install setup uses the explicit GMT default, even in a London browser.
    await expect(zone).toHaveValue('Etc/GMT');
    await expect(zone.getByRole('option', { name: 'GMT (UTC+00:00)', exact: true })).toHaveCount(1);
    await expect(zone.getByRole('option', { name: /London.*Europe\/London/ })).toHaveCount(1);
    await zone.selectOption('America/New_York');
    await expect(zone).toHaveValue('America/New_York');
    await page.getByLabel('Week starts on').selectOption('0');
    await zone.selectOption('Europe/London');
    await expect(page.getByRole('button', { name: 'New company', exact: true })).toHaveCount(0);
    await finishFirstCompanySetup(page, 'Queen Industries');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    const summary = page
      .getByRole('heading', { name: 'Company details' })
      .locator('xpath=ancestor::*[@data-slot="settings-row"]');
    await expect(summary.getByRole('row', { name: 'Company name Queen Industries' })).toBeVisible();
    await expect(summary.getByRole('row', { name: 'Week starts on Sunday' })).toBeVisible();
    await expect(
      summary.getByRole('row', { name: /Time zone London.*Europe\/London.*(?:BST|GMT)/ }),
    ).toBeVisible();
    await page.reload();
    await expect(summary.getByRole('row', { name: 'Week starts on Sunday' })).toBeVisible();
  });
});
