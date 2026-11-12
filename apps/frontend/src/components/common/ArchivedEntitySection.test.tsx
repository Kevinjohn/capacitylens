import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ArchiveRecovery } from '@capacitylens/shared/domain/lifecycle';
import { buildInternalClient } from '@capacitylens/shared/data/internalClient';
import type { ReactNode } from 'react';
import { AuthContext } from '@/auth/authContext';
import { PermissionContext } from '@/auth/permissionContext';
import {
  DEFAULT_ACCOUNT_ID,
  makeAppData,
  makeResource,
  resetStoreWithData,
  updatePlanningFixtureSource,
} from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { ArchivedEntitySection } from './ArchivedEntitySection';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/api/queryClient', async (original) => ({
  ...(await original<typeof import('@/api/queryClient')>()),
  client: { request },
}));

let serverData = makeAppData();
const archivedRecovery = (accountId: string): ArchiveRecovery => ({
  accountId,
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
        authMode: 'password-only',
        user: { id: 'test-principal' },
        refreshAuth: async () => {},
        signOut: async () => {},
      }}
    >
      <PermissionContext.Provider value={{ role, status: 'resolved' }}>
        {children}
      </PermissionContext.Provider>
    </AuthContext.Provider>
  );
}

beforeEach(async () => {
  request.mockReset();
  const resource = makeResource({
    id: 'resource-archive',
    accountId: DEFAULT_ACCOUNT_ID,
    name: 'Diana Prince',
    role: 'Designer',
    avatarUrl: 'https://images.example/diana.png',
    archivedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  });
  serverData = makeAppData({
    clients: [buildInternalClient(DEFAULT_ACCOUNT_ID, '2026-01-01T00:00:00.000Z')],
    resources: [resource],
  });
  await resetStoreWithData(serverData, DEFAULT_ACCOUNT_ID);
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
      return Response.json(serverData);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function setPlanningRole(role: 'owner' | 'editor') {
  useStore.setState((state) => ({
    planning: {
      ...state.planning,
      status: 'ready',
      canWrite: true,
      context: { identity: 'test-principal', companyId: DEFAULT_ACCOUNT_ID },
      accessKey: JSON.stringify(['test-principal', 'test-principal', role, true]),
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
      expect.stringContaining('/api/accounts/acct-test/resources/resource-archive/anonymise'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(useStore.getState().data.resources[0]?.avatarUrl).toBeNull();
  });

  it('lets an Editor recover an identity without inactive details or anonymisation', async () => {
    setPlanningRole('editor');
    request.mockResolvedValue(archivedRecovery(DEFAULT_ACCOUNT_ID));
    render(
      <QueryClientProvider client={new QueryClient()}>
        {authenticated(<ArchivedEntitySection entity="resources" />, 'editor')}
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Restore Diana Prince' })).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      'api.planning.archive',
      expect.objectContaining({ params: { accountId: DEFAULT_ACCOUNT_ID } }),
    );
    expect(screen.queryByText('Designer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Anonymise/ })).not.toBeInTheDocument();
  });
  it('restores an Editor identity through the typed planning command', async () => {
    await useStore.getState().refreshPlanning();
    setPlanningRole('editor');
    request
      .mockResolvedValueOnce(archivedRecovery(DEFAULT_ACCOUNT_ID))
      .mockResolvedValueOnce({ accountId: DEFAULT_ACCOUNT_ID, rows: [] });
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
      'api.planning.archive',
      expect.objectContaining({ params: { accountId: DEFAULT_ACCOUNT_ID } }),
    );
  });
});
