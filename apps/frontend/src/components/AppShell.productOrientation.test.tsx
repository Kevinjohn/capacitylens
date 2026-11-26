import { act } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPlanningData, makeCompany, makeAppData, DEFAULT_COMPANY_ID } from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { AppShell } from './AppShell';
import { HelpView } from './HelpView';
import { AuthContext } from '@/auth/authContext';
import type { AuthContextValue } from '@/auth/authContext';
import { buildProductOrientationKey } from '@/lib/productOrientation';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  loadPlanningData(makeAppData({ companies: [makeCompany()] }));
  useStore.getState().setCompanySummaries({
    list: [{ id: DEFAULT_COMPANY_ID, name: 'Wayne Enterprises', role: 'owner' }],
  });
  useStore.getState().setActiveCompany(DEFAULT_COMPANY_ID);
  useStore.getState().setHydrated(true);
  localStorage.setItem(buildProductOrientationKey('user-a', DEFAULT_COMPANY_ID), 'dismissed');
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/v1/companies')) {
        const state = useStore.getState();
        const summaries = state.companySummaries.length
          ? state.companySummaries
          : state.data.companies.map((company) => ({ ...company, role: 'owner' as const }));
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
        return Promise.resolve(
          Response.json({
            dismissed: true,
            steps: {
              person: false,
              client: false,
              project: false,
              activity: false,
              scheduled: false,
            },
          }),
        );
      }
      return Promise.resolve(Response.json({ active: false, masqueradeToken: 'idle' }));
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
    user: { id: userId, name: subjectNames[userId] ?? 'Bruce Wayne' },
    refreshAuth: async () => {},
    signOut: async () => {},
  };
}

function shellTree(path: string, auth = authenticatedAuth('user-a')) {
  const shell = (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={null} />
          <Route path="help" element={<HelpView />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
  return <AuthContext.Provider value={auth}>{shell}</AuthContext.Provider>;
}

function renderShell(path = '/', auth?: AuthContextValue) {
  return render(shellTree(path, auth));
}

describe('AppShell product orientation', () => {
  it('shows guidance without blocking the schedule and persists dismissal for the active company', async () => {
    localStorage.removeItem(buildProductOrientationKey('user-a', DEFAULT_COMPANY_ID));
    const user = userEvent.setup();
    renderShell();

    expect(screen.getByRole('region', { name: 'How CapacityLens works' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(
      screen.queryByRole('region', { name: 'How CapacityLens works' }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(buildProductOrientationKey('user-a', DEFAULT_COMPANY_ID))).toBe(
      'dismissed',
    );
  });

  it('reopens guidance from Help, focuses it, and returns focus to the Help button on close', async () => {
    localStorage.removeItem(buildProductOrientationKey('user-a', DEFAULT_COMPANY_ID));
    renderShell('/help');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(
      screen
        .queryByTestId('app-sidebar')
        ?.querySelector('[data-testid="product-orientation-reopen"]'),
    ).toBeNull();
    const reopen = await screen.findByTestId('product-orientation-reopen');
    expect(reopen).toHaveAccessibleName('How CapacityLens works');
    await user.click(reopen);
    expect(screen.getByRole('region', { name: 'How CapacityLens works' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'How CapacityLens works' })).toHaveFocus(),
    );
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(reopen).toHaveFocus();
  });

  it('focuses the visible orientation heading on entry', async () => {
    localStorage.removeItem(buildProductOrientationKey('user-a', DEFAULT_COMPANY_ID));
    renderShell();
    const heading = screen.getByRole('heading', { name: 'How CapacityLens works' });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('keeps a failed storage dismissal suppressed for the current mount', async () => {
    localStorage.removeItem(buildProductOrientationKey('user-a', DEFAULT_COMPANY_ID));
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
    useStore.getState().setActiveCompany(null);
    localStorage.removeItem(buildProductOrientationKey('user-a', 'no-company'));
    const user = userEvent.setup();
    renderShell('/account');

    expect(screen.getByRole('region', { name: 'How CapacityLens works' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(localStorage.getItem(buildProductOrientationKey('user-a', 'no-company'))).toBe(
      'dismissed',
    );
  });

  it('keeps the orientation action out of the sidebar, collapsed or not', () => {
    renderShell();
    act(() => useStore.getState().setSidebarOpen(false));

    expect(
      screen.queryByRole('button', { name: 'How CapacityLens works' }),
    ).not.toBeInTheDocument();
  });

  it('reopens guidance from Help on mobile and returns focus to the Help button', async () => {
    localStorage.removeItem(buildProductOrientationKey('user-a', DEFAULT_COMPANY_ID));
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
    renderShell('/help');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    const reopen = await screen.findByTestId('product-orientation-reopen');
    await user.click(reopen);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'How CapacityLens works' })).toHaveFocus(),
    );
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(reopen).toHaveFocus());
  });

  it('scopes guidance to the authenticated subject when the signed-in user changes', async () => {
    const firstSubject = authenticatedAuth('user-a');
    const secondSubject = authenticatedAuth('user-b');
    localStorage.removeItem(buildProductOrientationKey('user-a', DEFAULT_COMPANY_ID));
    localStorage.removeItem(buildProductOrientationKey('user-b', DEFAULT_COMPANY_ID));
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
        if (url.endsWith('/api/v1/companies')) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                { id: DEFAULT_COMPANY_ID, name: 'Wayne Enterprises', role: 'viewer' },
              ]),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          );
        }
        if (url.endsWith(`/api/v1/companies/${DEFAULT_COMPANY_ID}/getting-started`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                dismissed: false,
                steps: {
                  person: false,
                  client: false,
                  project: false,
                  activity: false,
                  scheduled: false,
                },
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ active: false, masqueradeToken: 'idle' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );
    localStorage.removeItem(buildProductOrientationKey('viewer-user', DEFAULT_COMPANY_ID));

    renderShell('/', authenticatedAuth('viewer-user'));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'How CapacityLens works' })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('active-role')).not.toBeInTheDocument();
  });

  it('preserves focus on an unrelated control across an ordinary shell rerender', async () => {
    const auth = authenticatedAuth('user-a');
    localStorage.removeItem(buildProductOrientationKey('user-a', DEFAULT_COMPANY_ID));
    const view = renderShell('/', auth);
    const heading = screen.getByRole('heading', { name: 'How CapacityLens works' });
    await waitFor(() => expect(heading).toHaveFocus());
    const unrelatedControl = screen.getByRole('link', { name: 'Schedule' });
    unrelatedControl.focus();

    view.rerender(shellTree('/', auth));

    expect(unrelatedControl).toHaveFocus();
  });
});
