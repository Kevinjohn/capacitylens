import { afterEach, beforeAll, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useStore } from '@/store/useStore';
import type { CompanySummary } from '@/store/useStore';
import { loadPlanningData, makeAppData, makeCompany, DEFAULT_COMPANY_ID } from '@/test/fixtures';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import { LocationProbe } from '@/test/LocationProbe';
import { grantFor } from '@/test/permissionGrants';
import { AuthContext } from '@/auth/authContext';
import { buildProductOrientationKey } from '@/lib/productOrientation';

export const authenticatedUser = {
  user: { id: 'app-shell-user', name: 'Bruce Wayne', email: 'bruce@example.test' },
  refreshAuth: async () => {},
  signOut: async () => {},
};

/** Company directory the stubbed `fetch` answers with; each test may change it. */
export const companyDirectory: { response: CompanySummary[]; pending: boolean; refused: boolean } =
  {
    response: [],
    pending: false,
    refused: false,
  };

/**
 * Registers the shell hooks every AppShell suite shares. The caller passes its own mocked
 * `syncLocaleFromCompany`, because each test file declares the `@/i18n` mock itself.
 */
export function setUpAppShellTests(syncLocaleFromCompany: Mock) {
  // Company switches load their masquerade model lazily. Loading it once here lets each test's switches
  // finish inside that test instead of landing in a later one.
  beforeAll(async () => {
    await import('@/auth/masqueradeModelInstance');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    syncLocaleFromCompany.mockReset();
    companyDirectory.response = [
      { id: DEFAULT_COMPANY_ID, name: 'Wayne Enterprises', role: 'owner' },
    ];
    companyDirectory.pending = false;
    companyDirectory.refused = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          'http://localhost',
        );
        if (url.pathname.replace(/\/$/, '') === '/api/v1/companies') {
          if (companyDirectory.pending) return new Promise<Response>(() => {});
          // The server refuses the directory when the installation holds more than one company.
          if (companyDirectory.refused) {
            return Response.json({ code: 'E_MULTIPLE_COMPANIES' }, { status: 409 });
          }
          return Response.json({
            data: companyDirectory.response.map(({ id, name, role, roleStatus }) =>
              roleStatus === 'unavailable'
                ? { id, name, role: 'unknown-role' }
                : { id, name, role, ...grantFor(role) },
            ),
          });
        }
        if (url.pathname.includes('/getting-started')) {
          return Response.json({
            data: {
              dismissed: true,
              steps: {
                person: false,
                client: false,
                project: false,
                activity: false,
                scheduled: false,
              },
            },
          });
        }
        return Response.json({ data: { active: false, masqueradeToken: 'idle' } });
      }),
    );
    // Seed an active company so these tests exercise the shell.
    localStorage.setItem(
      buildProductOrientationKey(authenticatedUser.user.id, DEFAULT_COMPANY_ID),
      'dismissed',
    );
    loadPlanningData(makeAppData({ companies: [makeCompany()] }));
    useStore.getState().setCompanySummaries({
      list: [{ id: DEFAULT_COMPANY_ID, name: 'Wayne Enterprises', role: 'owner' }],
    });
    useStore.getState().setActiveCompany(DEFAULT_COMPANY_ID);
    useStore.getState().clearFilters();
    // Clear any leftover transient notice so a prior test's Sonner toast can't bleed in (the
    // toast layer is module-global; the store notice is the source of truth the bridge reads).
    useStore.getState().setNotice(null);
    useStore.getState().setMasquerade({ kind: 'inactive' });
    // Most shell tests exercise the post-hydration UI; the dedicated handoff test overrides this.
    useStore.getState().setHydrated(true);
  });
}

type RenderAppShellOptions = { initialEntries?: string[]; includeLocationProbe?: boolean };
export function renderAppShell({
  initialEntries = ['/'],
  includeLocationProbe = false,
}: RenderAppShellOptions = {}) {
  return renderAuthenticated(
    <MemoryRouter initialEntries={initialEntries}>
      <AppShell />
      {includeLocationProbe && <LocationProbe />}
    </MemoryRouter>,
  );
}

export function renderAuthenticated(ui: ReactElement) {
  return render(<AuthContext.Provider value={authenticatedUser}>{ui}</AuthContext.Provider>);
}
