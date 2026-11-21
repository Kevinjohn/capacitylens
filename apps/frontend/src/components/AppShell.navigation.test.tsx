import { describe, it, expect, vi } from 'vitest';
import { screen, act, waitFor, within } from '@testing-library/react';
import { useStore } from '@/store/useStore';
import { loadPlanningData, makeAppData, makeCompany } from '@/test/fixtures';
import { m } from '@/i18n';
import { setUpAppShellTests, renderAppShell } from './AppShellTestKit';

const i18nMocks = vi.hoisted(() => ({ syncLocaleFromCompany: vi.fn() }));
vi.mock('@/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n')>()),
  syncLocaleFromCompany: i18nMocks.syncLocaleFromCompany,
}));

setUpAppShellTests(i18nMocks.syncLocaleFromCompany);

describe('AppShell navigation links', () => {
  it('places the focused skip link on its dedicated accessibility layer', () => {
    renderAppShell({});

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveClass(
      'focus:z-(--z-index-skip-link)',
    );
  });
  it('keeps a descriptive title on an accepted trailing-slash route', async () => {
    renderAppShell({ initialEntries: ['/resources/'] });

    await waitFor(() => expect(document.title).toBe('Resources · CapacityLens'));
  });

  it('keeps Account active on its accepted trailing-slash route', () => {
    renderAppShell({ initialEntries: ['/account/'] });

    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page');
  });
  it('resolves navigation labels again after the account locale changes', async () => {
    let secondLocale = false;
    vi.spyOn(m, 'nav_resources').mockImplementation(
      () => (secondLocale ? 'Ressources' : 'Resources') as ReturnType<typeof m.nav_resources>,
    );

    renderAppShell({ initialEntries: ['/resources'] });
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Resources' })).toBeInTheDocument(),
    );
    expect(document.title).toBe('Resources · CapacityLens');

    secondLocale = true;
    act(() => {
      useStore.setState({ data: makeAppData({ accounts: [makeCompany({ language: 'fr' })] }) });
    });

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Ressources' })).toBeInTheDocument(),
    );
    expect(document.title).toBe('Ressources · CapacityLens');
  });
  it("preserves the last locale while a selected company's slice is still loading", async () => {
    const currentAccount = makeCompany({ language: 'en' });
    const destinationCompany = makeCompany({ id: 'acct-other', name: 'Other Co' });
    loadPlanningData(makeAppData({ accounts: [currentAccount] }));
    renderAppShell({});
    await waitFor(() => expect(i18nMocks.syncLocaleFromCompany).toHaveBeenCalledWith('en'));
    i18nMocks.syncLocaleFromCompany.mockClear();

    // Model the ordinary server switch gap directly: the directory authorizes the destination,
    // activeCompanyId changes, and the old slice remains until the destination load resolves.
    act(() => {
      useStore.setState({
        activeCompanyId: destinationCompany.id,
        companySummaries: [
          { id: destinationCompany.id, name: destinationCompany.name, role: 'owner' },
        ],
      });
    });
    expect(i18nMocks.syncLocaleFromCompany).not.toHaveBeenCalled();

    act(() => useStore.setState({ data: makeAppData({ accounts: [destinationCompany] }) }));
    await waitFor(() => expect(i18nMocks.syncLocaleFromCompany).toHaveBeenCalledWith(undefined));
  });
  it('renders all expected nav links', () => {
    renderAppShell({});

    expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Resources' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Team & access' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Disciplines' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clients' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Activities' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Time off' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help');
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
    const footerHrefs = screen.getByTestId('app-sidebar').querySelectorAll('a');
    expect(Array.from(footerHrefs, (link) => link.getAttribute('href')).slice(-2)).toEqual([
      '/help',
      '/account',
    ]);
  });

  it('marks Help active and sets its page title on direct navigation', async () => {
    renderAppShell({ initialEntries: ['/help'] });

    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(document.title).toBe('Help · CapacityLens'));
  });
  it('marks the personal Account destination active and gives it a descriptive page title', async () => {
    renderAppShell({ initialEntries: ['/account'] });
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(document.title).toBe('Account · CapacityLens'));
  });

  it('keeps the personal Account route available before a company is selected', () => {
    useStore.setState({ activeCompanyId: null, companySummaries: [] });
    renderAppShell({ initialEntries: ['/account'] });

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
    expect(screen.queryByRole('heading', { name: 'Choose a company' })).not.toBeInTheDocument();
  });
  it('renders the CapacityLens brand name in the nav', () => {
    renderAppShell({});
    expect(screen.getByText('CapacityLens')).toBeInTheDocument();
  });
  it('does NOT render the import/export tools in the sidebar', () => {
    renderAppShell({});

    expect(screen.queryByTestId('settings-data-tools')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-data')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-data')).not.toBeInTheDocument();
  });
  it('keeps the avatar-led Account row as the only sidebar session control', () => {
    renderAppShell({});

    expect(screen.queryByText('Test Co')).not.toBeInTheDocument();
    expect(screen.queryByTestId('active-role')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch company' })).not.toBeInTheDocument();
    const account = screen.getByRole('link', { name: 'Account' });
    expect(account.querySelector("[data-slot='avatar']")).not.toBeNull();
    expect(screen.queryByTestId('nav-sign-out')).not.toBeInTheDocument();
  });
  it('pins Team & access and Settings, in that order, after every other destination', async () => {
    renderAppShell({});

    // Scoped to the nav landmark so the skip-to-content link above the sidebar stays out of it.
    await waitFor(() => {
      const order = within(screen.getByRole('navigation'))
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'));
      expect(order).toEqual([
        '/overview',
        '/',
        '/resources',
        '/disciplines',
        '/clients',
        '/projects',
        '/activities',
        '/timeoff',
        '/team',
        '/settings',
      ]);
    });
  });
  it('nav links point to correct routes', async () => {
    renderAppShell({});

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/overview'),
    );
    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Resources' })).toHaveAttribute('href', '/resources');
    expect(screen.getByRole('link', { name: 'Team & access' })).toHaveAttribute('href', '/team');
    expect(screen.getByRole('link', { name: 'Disciplines' })).toHaveAttribute(
      'href',
      '/disciplines',
    );
    expect(screen.getByRole('link', { name: 'Clients' })).toHaveAttribute('href', '/clients');
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('link', { name: 'Activities' })).toHaveAttribute('href', '/activities');
    expect(screen.getByRole('link', { name: 'Time off' })).toHaveAttribute('href', '/timeoff');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help');
    expect(screen.queryByRole('link', { name: 'Diagnostics' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Switch to (dark|light) mode$/ })).toBeNull();
    expect(screen.queryByTestId('product-orientation-reopen')).not.toBeInTheDocument();
  });
});
