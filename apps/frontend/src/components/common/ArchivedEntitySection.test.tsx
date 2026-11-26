import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ArchiveRecovery } from '@capacitylens/shared/domain/lifecycle';
import { buildInternalClient } from '@capacitylens/shared/data/internalClient';
import type { ReactNode } from 'react';
import { AuthContext } from '@/auth/authContext';
import { PermissionContext } from '@/auth/permissionContext';
import {
  DEFAULT_COMPANY_ID,
  makeAppData,
  makeResource,
  resetStoreWithData,
  updatePlanningFixtureSource,
} from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { ArchivedEntitySection } from './ArchivedEntitySection';
import { permissionValue } from '@/test/permissionGrants';
import { makePlanningAccess } from '@/test/planning/planningAccessFixtures';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/api/queryClient', async (original) => ({
  ...(await original<typeof import('@/api/queryClient')>()),
  client: { request },
}));

let serverData = makeAppData();
const archivedRecovery = (companyId: string): ArchiveRecovery => ({
  companyId,
  rows: [
    {
      entity: 'resources',
      group: 'studio',
      id: 'resource-archive',
      label: 'Diana Prince',
      archived: true,
      parent: null,
    },
  ],
});

function authenticated(children: ReactNode, role: 'owner' | 'editor') {
  return (
    <AuthContext.Provider
      value={{
        user: { id: 'test-user' },
        refreshAuth: async () => {},
        signOut: async () => {},
      }}
    >
      <PermissionContext.Provider value={permissionValue(role, 'resolved')}>
        {children}
      </PermissionContext.Provider>
    </AuthContext.Provider>
  );
}

beforeEach(async () => {
  request.mockReset();
  const resource = makeResource({
    id: 'resource-archive',
    companyId: DEFAULT_COMPANY_ID,
    name: 'Diana Prince',
    jobTitle: 'Designer',
    avatarUrl: 'https://images.example/diana.png',
    archivedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  });
  serverData = makeAppData({
    clients: [buildInternalClient(DEFAULT_COMPANY_ID, '2026-01-01T00:00:00.000Z')],
    resources: [resource],
  });
  await resetStoreWithData(serverData, DEFAULT_COMPANY_ID);
  setPlanningRole('owner');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        serverData = {
          ...serverData,
          resources: serverData.resources.map((row) =>
            row.id === 'resource-archive'
              ? { ...row, name: 'Anonymised person', avatarUrl: null }
              : row,
          ),
        };
        updatePlanningFixtureSource(serverData);
        return new Response(null, { status: 204 });
      }
      return Response.json({ data: serverData });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function setPlanningRole(role: 'owner' | 'editor') {
  useStore.setState((state) => ({
    planning: {
      ...state.planning,
      phase: { kind: 'ready', lastWrite: null },
      context: { identity: 'test-user', companyId: DEFAULT_COMPANY_ID },
      access: makePlanningAccess({ role }),
    },
  }));
}

describe('archived resource actions', () => {
  it('confirms and applies resource anonymisation through the server action', async () => {
    const user = userEvent.setup();
    render(authenticated(<ArchivedEntitySection entity="resources" />, 'owner'));
    await user.click(await screen.findByRole('button', { name: 'Anonymise Diana Prince' }));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('includeInactive=1'),
      expect.objectContaining({ credentials: 'include' }),
    );
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('This cannot be undone.');
    await user.click(within(dialog).getByRole('button', { name: 'Anonymise' }));
    await waitFor(() =>
      expect(useStore.getState().data.resources[0]?.name).toBe('Anonymised person'),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/companies/acct-test/resources/resource-archive/anonymise'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(useStore.getState().data.resources[0]?.avatarUrl).toBeNull();
  });

  it('lets an Editor recover an identity without inactive details or anonymisation', async () => {
    setPlanningRole('editor');
    request.mockResolvedValue({ data: archivedRecovery(DEFAULT_COMPANY_ID) });
    render(
      <QueryClientProvider client={new QueryClient()}>
        {authenticated(<ArchivedEntitySection entity="resources" />, 'editor')}
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Restore Diana Prince' })).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      'api.planning_archive.show',
      expect.objectContaining({ params: { companyId: DEFAULT_COMPANY_ID } }),
    );
    expect(screen.queryByText('Designer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Anonymise/ })).not.toBeInTheDocument();
  });
  it('restores an Editor identity through the typed planning intent', async () => {
    await useStore.getState().refreshPlanning();
    setPlanningRole('editor');
    request
      .mockResolvedValueOnce({ data: archivedRecovery(DEFAULT_COMPANY_ID) })
      .mockResolvedValueOnce({ data: { companyId: DEFAULT_COMPANY_ID, rows: [] } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        {authenticated(<ArchivedEntitySection entity="resources" />, 'editor')}
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Restore Diana Prince' }));
    await waitFor(() =>
      expect(screen.queryByTestId('archived-resources-section')).not.toBeInTheDocument(),
    );
    expect(useStore.getState().data.resources[0]?.archivedAt).toBeNull();
    expect(request).toHaveBeenCalledWith(
      'api.planning_archive.show',
      expect.objectContaining({ params: { companyId: DEFAULT_COMPANY_ID } }),
    );
  });
});
