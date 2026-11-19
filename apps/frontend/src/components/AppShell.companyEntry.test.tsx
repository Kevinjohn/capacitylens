import { it, expect, vi } from 'vitest';
import { screen, act, fireEvent, waitFor } from '@testing-library/react';
import { useStore } from '@/store/useStore';
import { loadPlanningData, makeAppData, makeAccount, DEFAULT_COMPANY_ID } from '@/test/fixtures';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import { setUpAppShellTests, accountDirectory, renderAppShell } from './AppShell.testSupport';

const i18nMocks = vi.hoisted(() => ({ syncLocaleFromAccount: vi.fn() }));
vi.mock('@/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n')>()),
  syncLocaleFromAccount: i18nMocks.syncLocaleFromAccount,
}));

setUpAppShellTests(i18nMocks.syncLocaleFromAccount);

it('consumes a joined-account query only once and preserves later route queries', async () => {
  renderAppShell({
    initialEntries: [`/?joinedAccount=${DEFAULT_COMPANY_ID}`],
    includeLocationProbe: true,
  });

  await waitFor(() => expect(screen.getByTestId('location-probe')).toHaveTextContent(/^\/$/));
  fireEvent.click(screen.getByTestId('location-probe'));
  await waitFor(() =>
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/settings?tab=security'),
  );
});

it('removes only the joined-account handoff from the entry query', async () => {
  renderAppShell({
    initialEntries: [`/?tab=security&joinedAccount=${DEFAULT_COMPANY_ID}&view=archived#members`],
    includeLocationProbe: true,
  });

  await waitFor(() =>
    expect(screen.getByTestId('location-probe')).toHaveTextContent(
      '/?tab=security&view=archived#members',
    ),
  );
});

it('waits for initial hydration before consuming a joined-account handoff', async () => {
  useStore.getState().setActiveCompany(null);
  useStore.getState().setHydrated(false);

  renderAppShell({ initialEntries: [`/?joinedAccount=${DEFAULT_COMPANY_ID}`] });

  await waitFor(() =>
    expect(
      useStore.getState().companySummaries.some((account) => account.id === DEFAULT_COMPANY_ID),
    ).toBe(true),
  );
  expect(useStore.getState().activeCompanyId).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Loading');

  act(() => useStore.getState().setHydrated(true));
  await waitFor(() => expect(useStore.getState().activeCompanyId).toBe(DEFAULT_COMPANY_ID));
});

it('does not reactivate a consumed joined-account handoff after a later account-list refresh', async () => {
  const otherAccountId = 'acct-other';
  const accounts = [makeAccount(), makeAccount({ id: otherAccountId, name: 'Other Co' })];
  accountDirectory.response = accounts.map(({ id, name }) => ({ id, name, role: 'owner' }));
  loadPlanningData(makeAppData({ accounts }));
  useStore
    .getState()
    .setCompanySummaries({ list: accounts.map(({ id, name }) => ({ id, name, role: 'owner' })) });
  useStore.getState().setActiveCompany(otherAccountId);

  renderAppShell({ initialEntries: [`/?joinedAccount=${DEFAULT_COMPANY_ID}`] });
  act(() => useStore.getState().setHydrated(true));
  await waitFor(() => expect(useStore.getState().activeCompanyId).toBe(DEFAULT_COMPANY_ID));

  act(() => {
    useStore.getState().setActiveCompany(otherAccountId);
    useStore
      .getState()
      .setCompanySummaries({ list: accounts.map(({ id, name }) => ({ id, name, role: 'owner' })) });
  });

  expect(useStore.getState().activeCompanyId).toBe(otherAccountId);
});

it('does not apply a late joined-account handoff after an explicit company choice', async () => {
  const lateAccountId = 'acct-late';
  useStore.getState().setActiveCompany(null);

  renderAppShell({ initialEntries: [`/?joinedAccount=${lateAccountId}`] });
  await waitFor(() =>
    expect(
      useStore.getState().companySummaries.some((account) => account.id === DEFAULT_COMPANY_ID),
    ).toBe(true),
  );

  act(() => useStore.getState().setActiveCompany(DEFAULT_COMPANY_ID));
  act(() => {
    useStore.getState().setCompanySummaries({
      list: [
        ...useStore.getState().companySummaries,
        { id: lateAccountId, name: 'Late Co', role: 'owner' },
      ],
    });
  });

  expect(useStore.getState().activeCompanyId).toBe(DEFAULT_COMPANY_ID);
});

it('shows an installation error when the account directory contains multiple memberships', async () => {
  const accounts = [makeAccount(), makeAccount({ id: 'acct-other', name: 'Other Co' })];
  accountDirectory.refused = true;
  loadPlanningData(makeAppData({ accounts }));
  useStore.setState({
    activeCompanyId: null,
    companySummaries: accounts.map(({ id, name }) => ({ id, name, role: 'owner' as const })),
  });

  renderAppShell({ initialEntries: ['/account'] });

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This installation has more than one company. Contact your administrator to resolve it.',
  );
  expect(screen.queryByRole('button', { name: 'Other Co' })).not.toBeInTheDocument();
  expect(useStore.getState().activeCompanyId).toBeNull();
});

it('loads until the directory is complete, then opens its sole company', async () => {
  accountDirectory.pending = true;
  loadPlanningData(emptyAppData());
  useStore.setState({
    activeCompanyId: null,
    companySummaries: [{ id: 'only-valid-row', name: 'Only Visible Co', role: 'owner' }],
    companySummariesComplete: false,
  });

  renderAppShell({});

  await waitFor(() => expect(useStore.getState().activeCompanyId).toBeNull());
  expect(screen.getByRole('status')).toHaveTextContent('Loading');

  act(() => {
    void useStore.getState().setCompanySummaries({
      list: [{ id: 'only-valid-row', name: 'Only Visible Co', role: 'owner' }],
      complete: true,
    });
  });
  await waitFor(() => expect(useStore.getState().activeCompanyId).toBe('only-valid-row'));
});

it('waits when the sole membership role is unavailable', async () => {
  accountDirectory.response = [
    {
      id: 'unavailable-account',
      name: 'Unavailable Co',
      role: 'viewer',
      roleStatus: 'unavailable',
    },
  ];
  loadPlanningData(emptyAppData());
  useStore.setState({
    activeCompanyId: null,
    companySummaries: [
      {
        id: 'unavailable-account',
        name: 'Unavailable Co',
        role: 'viewer',
        roleStatus: 'unavailable',
      },
    ],
  });

  renderAppShell({});

  await waitFor(() => expect(useStore.getState().activeCompanyId).toBeNull());
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
});

it('opens the sole server-selected company after a reload even when an invite handoff is present', async () => {
  useStore.setState({ activeCompanyId: null });

  renderAppShell({ initialEntries: ['/clients?joinedAccount=not-yet-authorized'] });

  await waitFor(() => expect(useStore.getState().activeCompanyId).toBe(DEFAULT_COMPANY_ID));
  expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument();
});

it('keeps the server-selected company when its active slice is empty', async () => {
  const summary = { id: DEFAULT_COMPANY_ID, name: 'Wayne Enterprises', role: 'owner' as const };
  useStore.setState({
    activeCompanyId: null,
    companySummaries: [summary],
  });
  renderAppShell({});
  await waitFor(() => expect(useStore.getState().activeCompanyId).toBe(DEFAULT_COMPANY_ID));

  act(() => {
    loadPlanningData(emptyAppData());
    useStore.getState().setCompanySummaries({ list: [summary] });
  });

  await waitFor(() => expect(useStore.getState().activeCompanyId).toBe(DEFAULT_COMPANY_ID));
  expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument();
  expect(useStore.getState().notice).toBeNull();
});
