import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { requireCreated } from '@/test/requireCreated';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { render as renderTestingLibrary, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClientList } from './ClientList';
import { useStore } from '@/store/useStore';
import {
  DEFAULT_ACCOUNT_ID,
  loadPlanningData,
  makeClient,
  resetStoreWithAccount,
  requireValue,
} from '@/test/fixtures';
import { buildInternalClient } from '@capacitylens/shared/data/internalClient';
import { AuthContext } from '@/auth/authContext';
import { PermissionContext } from '@/auth/permissionContext';
import { OwnerPermissions } from '@/test/ownerPermissions';
import { queuePlanningPatch } from '@/test/planning/queuePlanningPatch';

const { archiveRequest } = vi.hoisted(() => ({ archiveRequest: vi.fn() }));
vi.mock('@/api/queryClient', async (original) => ({
  ...(await original<typeof import('@/api/queryClient')>()),
  client: { request: archiveRequest },
}));

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider
      value={{
        authMode: 'password-only',
        user: { id: 'test-principal' },
        refreshAuth: async () => {},
        signOut: async () => {},
      }}
    >
      <OwnerPermissions>{children}</OwnerPermissions>
    </AuthContext.Provider>
  );
}

const render = (ui: Parameters<typeof renderTestingLibrary>[0]) =>
  renderTestingLibrary(ui, { wrapper: TestProviders });

function mockInactiveRead() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const data = structuredClone(useStore.getState().data);
      const internal = buildInternalClient(DEFAULT_ACCOUNT_ID, '2026-01-01T00:00:00.000Z');
      return Response.json({
        ...data,
        clients: [...data.clients.filter((client) => client.id !== internal.id), internal],
      });
    }),
  );
}

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

function markClientArchived(clientId: string) {
  const data = useStore.getState().data;
  loadPlanningData({
    ...data,
    clients: data.clients.map((client) =>
      client.id === clientId ? { ...client, archivedAt: '2026-01-01T00:00:00.000Z' } : client,
    ),
  });
}

afterEach(() => vi.unstubAllGlobals());

beforeEach(async () => {
  await resetStoreWithAccount();
  archiveRequest.mockReset();
  mockInactiveRead();
});

describe('ClientList empty state', () => {
  it('shows the enriched empty state with a CTA distinct from the top Add button', () => {
    render(<ClientList />);
    expect(screen.getByText('No clients yet.')).toBeInTheDocument();
    // The empty-state CTA and the page's top button have distinct accessible names, so
    // getByRole stays unambiguous for each (no duplicate-name collision).
    expect(screen.getByRole('button', { name: 'Add client' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add your first client' })).toBeInTheDocument();
  });

  it('CTA opens the same create form as the top Add button', async () => {
    const user = userEvent.setup();
    render(<ClientList />);
    await user.click(screen.getByRole('button', { name: 'Add your first client' }));
    expect(screen.getByRole('dialog', { name: 'Add client' })).toBeInTheDocument();
  });
});

it('sorts visible clients alphabetically after hiding Internal without changing stored order', async () => {
  await useStore.getState().addClient({ name: 'Zulu', color: '#2d75da' });
  await useStore.getState().addClient({ name: 'alpha', color: '#76a5e7' });
  await useStore.getState().addClient({ name: 'Bravo', color: '#da2d92' });
  const storedIds = useStore.getState().data.clients.map((client) => client.id);

  render(<ClientList />);

  expect(screen.getAllByTestId('client-row').map((row) => row.textContent)).toEqual([
    'alpha',
    'Bravo',
    'Zulu',
  ]);
  expect(screen.queryByText('Internal')).not.toBeInTheDocument();
  expect(useStore.getState().data.clients.map((client) => client.id)).toEqual(storedIds);
});

it('gives repeated client edit controls distinct contextual names', async () => {
  await useStore.getState().addClient({ name: 'Ferris', color: '#2d75da' });
  await useStore.getState().addClient({ name: 'Globex', color: '#76a5e7' });
  render(<ClientList />);

  expect(screen.getByRole('button', { name: 'Edit Ferris' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Edit Globex' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
});

// Archiving hides a client and its descendants from active views while retaining them for restoration.
describe('ClientList archive flow', () => {
  it('confirms before archiving and keeps the client + its children in the data', async () => {
    const user = userEvent.setup();
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Ferris', color: '#2d75da' }),
    );
    const project = await requireCreated(
      useStore.getState().addProject({ name: 'P', clientId: client.id, color: '#76a5e7' }),
    );
    await useStore.getState().addPhase({ name: 'Discovery', projectId: project.id });
    await useStore.getState().addActivity({ name: 'T', kind: 'project', projectId: project.id });
    render(<ClientList />);

    expect(screen.getByText('Ferris')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Archive Ferris' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/Archive client\?/i);
    expect(dialog).toHaveTextContent(
      'This also hides 1 project, 1 phase, and 0 allocations from the schedule; restore the client to bring them back.',
    );

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(requireValue(useStore.getState().data.clients[0], 'active client')).toHaveProperty(
      'archivedAt',
      null,
    );

    await user.click(screen.getByRole('button', { name: 'Archive Ferris' }));
    queuePlanningPatch(() => ({
      upserts: [{ entity: 'clients', row: { ...client, archivedAt: '2026-01-01T00:00:00.000Z' } }],
      removed: [],
    }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Archive',
      }),
    );

    expect(useStore.getState().data.clients).toHaveLength(1);
    expect(useStore.getState().data.clients[0]?.archivedAt).toBeTruthy();
    expect(useStore.getState().data.projects).toHaveLength(1);
    expect(useStore.getState().data.phases).toHaveLength(1);
    expect(useStore.getState().data.activities).toHaveLength(1);
    expect(screen.queryByTestId('client-row')).not.toBeInTheDocument();
    expect(
      within(await screen.findByTestId('archived-clients-section')).getByText('Ferris'),
    ).toBeInTheDocument();
  });

  it('omits the cascade warning for a client without projects or allocations', async () => {
    const user = userEvent.setup();
    await useStore.getState().addClient({ name: 'Childless', color: '#2d75da' });
    render(<ClientList />);

    await user.click(screen.getByRole('button', { name: 'Archive Childless' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Archive "Childless"?');
    expect(dialog).not.toHaveTextContent('This also hides');
  });

  it('tells Editors they can recover the archived client inline', async () => {
    const user = userEvent.setup();
    await useStore.getState().addClient({ name: 'Ferris', color: '#2d75da' });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PermissionContext.Provider value={{ role: 'editor', status: 'resolved' }}>
          <ClientList />
        </PermissionContext.Provider>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Archive Ferris' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Editors, Admins and Owners can restore it from Archived clients.',
    );
  });

  it('keeps exactly one quote pair around a redacted private code name in confirmation copy', async () => {
    const user = userEvent.setup();
    const created = await requireCreated(
      useStore.getState().addClient({ name: 'Real client', color: '#2d75da' }),
    );
    const client = { ...created, name: '"Nightwing"', isPrivate: true };
    loadPlanningData({ ...useStore.getState().data, clients: [client] });
    render(<ClientList />);

    await user.click(screen.getByRole('button', { name: 'Archive "Nightwing"' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Archive client?' });
    expect(dialog).toHaveTextContent('Archive "Nightwing"?');
    expect(dialog).not.toHaveTextContent('""Nightwing""');
  });

  it('lets an Editor restore an archived identity without inactive management details', async () => {
    const user = userEvent.setup();
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Ferris', color: '#2d75da' }),
    );
    markClientArchived(client.id);
    setPlanningRole('editor');
    archiveRequest.mockResolvedValueOnce({
      accountId: DEFAULT_ACCOUNT_ID,
      rows: [{ entity: 'clients', id: client.id, label: 'Ferris', archived: true, parent: null }],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PermissionContext.Provider value={{ role: 'editor', status: 'resolved' }}>
          <ClientList />
        </PermissionContext.Provider>
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('client-row')).not.toBeInTheDocument();
    const archive = within(await screen.findByTestId('archived-clients-section'));
    expect(archive.getByText('Ferris')).toBeInTheDocument();
    expect(archive.queryByRole('button', { name: /Edit|Anonymise/ })).not.toBeInTheDocument();
    queuePlanningPatch(() => ({
      upserts: [{ entity: 'clients', row: { ...client, archivedAt: null } }],
      removed: [],
    }));
    archiveRequest.mockResolvedValueOnce({ accountId: DEFAULT_ACCOUNT_ID, rows: [] });
    await user.click(archive.getByRole('button', { name: 'Restore Ferris' }));
    expect(screen.getByTestId('client-row')).toHaveTextContent('Ferris');
    await waitFor(() =>
      expect(screen.queryByTestId('archived-clients-section')).not.toBeInTheDocument(),
    );
  });

  it('hides archived clients from a Viewer', async () => {
    const role = 'viewer';
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Ferris', color: '#2d75da' }),
    );
    markClientArchived(client.id);

    render(
      <PermissionContext.Provider value={{ role, status: 'resolved' }}>
        <ClientList />
      </PermissionContext.Provider>,
    );

    expect(screen.queryByText('Ferris')).not.toBeInTheDocument();
    expect(screen.queryByTestId('archived-clients-section')).not.toBeInTheDocument();
  });

  it('restores an archived client from the expanded section', async () => {
    const user = userEvent.setup();
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Ferris', color: '#2d75da' }),
    );
    markClientArchived(client.id);
    render(<ClientList />);

    queuePlanningPatch(() => ({
      upserts: [{ entity: 'clients', row: { ...client, archivedAt: null } }],
      removed: [],
    }));
    await user.click(await screen.findByRole('button', { name: 'Restore Ferris' }));

    expect(useStore.getState().data.clients[0]).toHaveProperty('archivedAt', null);
    expect(screen.getByTestId('client-row')).toHaveTextContent('Ferris');
    await waitFor(() =>
      expect(screen.queryByTestId('archived-clients-section')).not.toBeInTheDocument(),
    );
  });
});

// The built-in Internal client is a persisted project bucket, so ordinary client management must neither list nor archive it.
describe('ClientList withholds the Archive affordance for the built-in Internal client', () => {
  it('renders no row and no Archive control for the Internal client (only normal clients show)', async () => {
    const internal = buildInternalClient(DEFAULT_ACCOUNT_ID, '2026-05-01T00:00:00.000Z');
    loadPlanningData({
      ...useStore.getState().data,
      clients: [
        internal,
        makeClient({ id: 'normal-client', accountId: DEFAULT_ACCOUNT_ID, name: 'Globex' }),
      ],
    });
    await useStore.getState().refreshPlanning();

    render(<ClientList />);

    expect(screen.getByText('Globex')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive Globex' })).toBeInTheDocument();

    expect(screen.queryByText(internal.name)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `Archive ${internal.name}` }),
    ).not.toBeInTheDocument();
  });
});
