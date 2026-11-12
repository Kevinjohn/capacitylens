import { act } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPlanningData, makeAccount, makeAppData, DEFAULT_ACCOUNT_ID } from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { AppShell } from './AppShell';
import { AuthContext } from '@/auth/authContext';
import type { AuthContextValue } from '@/auth/authContext';
import { buildProductOrientationKey } from '@/lib/productOrientation';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  loadPlanningData(makeAppData({ accounts: [makeAccount()] }));
  useStore.getState().setAccountSummaries({
    list: [{ id: DEFAULT_ACCOUNT_ID, name: 'Wayne Enterprises', role: 'owner' }],
  });
  useStore.getState().setActiveAccount(DEFAULT_ACCOUNT_ID);
  useStore.getState().setHydrated(true);
  localStorage.setItem(buildProductOrientationKey('user-a', DEFAULT_ACCOUNT_ID), 'dismissed');
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/accounts')) {
        const state = useStore.getState();
        const summaries = state.accountSummaries.length
          ? state.accountSummaries
          : state.data.accounts.map((account) => ({ ...account, role: 'owner' as const }));
        return Promise.resolve(
          Response.json(
            summaries.map((summary) => ({
              id: summary.id,
              name: summary.name,
              role:
                'roleStatus' in summary && summary.roleStatus === 'unavailable'
                  ? 'unknown-role'
                  : summary.role,
            })),
          ),
        );
      }
      if (url.includes('/getting-started')) {
        return Promise.resolve(Response.json({ dismissed: true }));
      }
      return Promise.resolve(Response.json({ active: false, contextToken: 'idle' }));
    }),
  );
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
    refreshAuth: async () => {},
    signOut: async () => {},
  };
}

function shellTree(path: string, auth = authenticatedAuth('user-a')) {
  const shell = (
    <MemoryRouter initialEntries={[path]}>
      <AppShell />
    </MemoryRouter>
  );
  return <AuthContext.Provider value={auth}>{shell}</AuthContext.Provider>;
}

function renderShell(path = '/', auth?: AuthContextValue) {
  return render(shellTree(path, auth));
}

describe('AppShell product orientation', () => {
  it('shows guidance without blocking the schedule and persists dismissal for the active company', async () => {
    localStorage.removeItem(buildProductOrientationKey('user-a', DEFAULT_ACCOUNT_ID));
    const user = userEvent.setup();
    renderShell();

    expect(screen.getByRole('region', { name: 'How CapacityLens works' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(
      screen.queryByRole('region', { name: 'How CapacityLens works' }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(buildProductOrientationKey('user-a', DEFAULT_ACCOUNT_ID))).toBe(
      'dismissed',
    );
  });

  it('reopens and focuses guidance from the named sidebar action', async () => {
    localStorage.removeItem(buildProductOrientationKey('user-a', DEFAULT_ACCOUNT_ID));
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
    localStorage.removeItem(buildProductOrientationKey('user-a', DEFAULT_ACCOUNT_ID));
    renderShell();
    const heading = screen.getByRole('heading', { name: 'How CapacityLens works' });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('keeps a failed storage dismissal suppressed for the current mount', async () => {
    localStorage.removeItem(buildProductOrientationKey('user-a', DEFAULT_ACCOUNT_ID));
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
    localStorage.removeItem(buildProductOrientationKey('user-a', 'no-company'));
    const user = userEvent.setup();
    renderShell('/account');

    expect(screen.getByRole('region', { name: 'How CapacityLens works' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(localStorage.getItem(buildProductOrientationKey('user-a', 'no-company'))).toBe(
      'dismissed',
    );
  });

  it('keeps the orientation action available in the collapsed sidebar', () => {
    renderShell();
    act(() => useStore.getState().setSidebarOpen(false));

    expect(screen.getByRole('button', { name: 'How CapacityLens works' })).toBeInTheDocument();
  });

  it('keeps the orientation action available in the mobile sidebar and returns focus to its trigger', async () => {
    localStorage.removeItem(buildProductOrientationKey('user-a', DEFAULT_ACCOUNT_ID));
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

  it('keeps the orientation guidance available to an authenticated Viewer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
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
