import { act } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAccount, makeAppData, DEFAULT_ACCOUNT_ID } from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { AppShell } from './AppShell';
import { AuthContext } from '@/auth/authContext';
import type { AuthContextValue } from '@/auth/authContext';
import { buildProductOrientationKey } from '@/lib/productOrientation';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';

const serverFlag = vi.hoisted(() => ({ on: false }));
vi.mock('@/data/apiConfig', () => ({
  API_BASE: '',
  isDemoMode: () => !serverFlag.on,
  isServerConfigured: () => serverFlag.on,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  serverFlag.on = false;
  useStore.getState().replaceAll(makeAppData({ accounts: [makeAccount()] }));
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
  useStore.getState().setHydrated(true);
  localStorage.setItem('capacitylens/productOrientation/v1/demo/acct-test', 'dismissed');
});

function authenticatedAuth(userId: string): AuthContextValue {
  const subjectNames: Record<string, string> = {
    'user-a': 'Bruce Wayne',
    'user-b': 'Tony Stark',
    'viewer-user': 'Bruce Wayne',
  };
  return {
    authMode: 'password-only',
    user: { id: userId, name: subjectNames[userId] ?? 'Bruce Wayne' },
    canCreateAccount: true,
    refreshAuth: async () => {},
    signOut: async () => {},
  };
}

function shellTree(path: string, auth?: AuthContextValue) {
  const shell = (
    <MemoryRouter initialEntries={[path]}>
      <AppShell />
    </MemoryRouter>
  );
  return auth ? <AuthContext.Provider value={auth}>{shell}</AuthContext.Provider> : shell;
}

function renderShell(path = '/', auth?: AuthContextValue) {
  return render(shellTree(path, auth));
}

describe('AppShell product orientation', () => {
  it('shows guidance without blocking the schedule and persists dismissal for the active company', async () => {
    localStorage.removeItem('capacitylens/productOrientation/v1/demo/acct-test');
    const user = userEvent.setup();
    renderShell();

    expect(screen.getByRole('region', { name: 'How CapacityLens works' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(
      screen.queryByRole('region', { name: 'How CapacityLens works' }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem('capacitylens/productOrientation/v1/demo/acct-test')).toBe(
      'dismissed',
    );
  });

  it('reopens and focuses guidance from the named sidebar action', async () => {
    localStorage.removeItem('capacitylens/productOrientation/v1/demo/acct-test');
    renderShell();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    const reopen = screen.getByRole('button', { name: 'How CapacityLens works' });
    await user.click(reopen);
    expect(screen.getByRole('region', { name: 'How CapacityLens works' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'How CapacityLens works' })).toHaveFocus(),
    );
    expect(reopen).toHaveAttribute('data-testid', 'product-orientation-reopen');
  });

  it('focuses the visible orientation heading on entry', async () => {
    localStorage.removeItem('capacitylens/productOrientation/v1/demo/acct-test');
    renderShell();
    const heading = screen.getByRole('heading', { name: 'How CapacityLens works' });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('keeps a failed storage dismissal suppressed for the current mount', async () => {
    localStorage.removeItem('capacitylens/productOrientation/v1/demo/acct-test');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key) => {
      if (String(key).includes('productOrientation')) throw new Error('blocked');
    });
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(
      screen.queryByRole('region', { name: 'How CapacityLens works' }),
    ).not.toBeInTheDocument();
  });

  it('scopes the no-company Account view to a stable account-state segment', async () => {
    useStore.getState().setActiveAccount(null);
    localStorage.removeItem('capacitylens/productOrientation/v1/demo/no-company');
    const user = userEvent.setup();
    renderShell('/account');

    expect(screen.getByRole('region', { name: 'How CapacityLens works' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(localStorage.getItem('capacitylens/productOrientation/v1/demo/no-company')).toBe(
      'dismissed',
    );
  });

  it('keeps the orientation action available in the collapsed sidebar', () => {
    renderShell();
    act(() => useStore.getState().setSidebarOpen(false));

    expect(screen.getByRole('button', { name: 'How CapacityLens works' })).toBeInTheDocument();
  });

  it('keeps the orientation action available in the mobile sidebar and returns focus to its trigger', async () => {
    localStorage.removeItem('capacitylens/productOrientation/v1/demo/acct-test');
    vi.stubGlobal(
      'matchMedia',
      vi.fn(
        () =>
          ({
            matches: true,
            media: '(max-width: 767px)',
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(() => true),
          }) satisfies MediaQueryList,
      ),
    );
    sessionStorage.setItem('capacitylens/rotateHintDismissed', '1');
    renderShell();
    const user = userEvent.setup();
    const menuTrigger = screen.getByRole('button', { name: 'Expand menu' });
    await user.keyboard('{Control>}b{/Control}');
    const orientationAction = screen.getByRole('button', { name: 'How CapacityLens works' });
    expect(screen.getByRole('button', { name: 'Collapse menu' })).toBeInTheDocument();
    await user.click(orientationAction);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'How CapacityLens works' })).toHaveFocus(),
    );
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(menuTrigger).toHaveFocus());

    await user.click(menuTrigger);
    await user.click(screen.getByRole('button', { name: 'How CapacityLens works' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'How CapacityLens works' })).toHaveFocus(),
    );
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(menuTrigger).toHaveFocus());
  });

  it('scopes guidance to the authenticated subject when the signed-in user changes', async () => {
    const firstSubject = authenticatedAuth('user-a');
    const secondSubject = authenticatedAuth('user-b');
    localStorage.removeItem(buildProductOrientationKey('user-a', DEFAULT_ACCOUNT_ID));
    localStorage.removeItem(buildProductOrientationKey('user-b', DEFAULT_ACCOUNT_ID));
    const user = userEvent.setup();
    const view = renderShell('/', firstSubject);

    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(
      screen.queryByRole('region', { name: 'How CapacityLens works' }),
    ).not.toBeInTheDocument();

    view.rerender(shellTree('/', secondSubject));
    expect(screen.getByRole('region', { name: 'How CapacityLens works' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));

    view.rerender(shellTree('/', firstSubject));
    expect(
      screen.queryByRole('region', { name: 'How CapacityLens works' }),
    ).not.toBeInTheDocument();
  });

  it('follows company A to B to A without leaking dismissal between companies', async () => {
    const accountA = makeAccount({ id: 'acct-a', name: 'Wayne Enterprises' });
    const accountB = makeAccount({ id: 'acct-b', name: 'Stark Industries' });
    useStore.getState().replaceAll(makeAppData({ accounts: [accountA, accountB] }));
    useStore.getState().setAccountSummaries({
      list: [
        { id: accountA.id, name: accountA.name, role: 'owner' },
        { id: accountB.id, name: accountB.name, role: 'owner' },
      ],
    });
    useStore.getState().setActiveAccount(accountA.id);
    localStorage.removeItem(buildProductOrientationKey('user-a', accountA.id));
    localStorage.removeItem(buildProductOrientationKey('user-a', accountB.id));
    const user = userEvent.setup();
    renderShell('/', authenticatedAuth('user-a'));

    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(
      screen.queryByRole('region', { name: 'How CapacityLens works' }),
    ).not.toBeInTheDocument();

    act(() => useStore.getState().setActiveAccount(accountB.id));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'How CapacityLens works' })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Got it' }));

    act(() => useStore.getState().setActiveAccount(accountA.id));
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'How CapacityLens works' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('keeps the orientation guidance available to an authenticated Viewer', async () => {
    serverFlag.on = true;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/accounts')) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                { id: DEFAULT_ACCOUNT_ID, name: 'Wayne Enterprises', role: 'viewer' },
              ]),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          );
        }
        if (url.endsWith(`/api/accounts/${DEFAULT_ACCOUNT_ID}/getting-started`)) {
          return Promise.resolve(
            new Response(JSON.stringify({ dismissed: false }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ active: false, contextToken: 'idle' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );
    localStorage.removeItem(buildProductOrientationKey('viewer-user', DEFAULT_ACCOUNT_ID));

    renderShell('/', authenticatedAuth('viewer-user'));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'How CapacityLens works' })).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByTestId('active-role')).toHaveTextContent('Viewer'));
    expect(screen.getByRole('button', { name: 'How CapacityLens works' })).toBeInTheDocument();
  });

  it('preserves focus on an unrelated control across an ordinary shell rerender', async () => {
    const auth = authenticatedAuth('user-a');
    localStorage.removeItem(buildProductOrientationKey('user-a', DEFAULT_ACCOUNT_ID));
    const view = renderShell('/', auth);
    const heading = screen.getByRole('heading', { name: 'How CapacityLens works' });
    await waitFor(() => expect(heading).toHaveFocus());
    const unrelatedControl = screen.getByRole('link', { name: 'Schedule' });
    unrelatedControl.focus();

    view.rerender(shellTree('/', auth));

    expect(unrelatedControl).toHaveFocus();
  });
});
