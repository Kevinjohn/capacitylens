import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthContext } from '@/auth/authContext';
import { PermissionContext } from '@/auth/permissionContext';
import { notifyInactiveDataChanged } from '@/data/inactiveDataEvents';
import { useStore } from '@/store/useStore';
import { createEmptyAppData } from '@capacitylens/shared/types/entities';
import { buildInternalClient } from '@capacitylens/shared/data/internalClient';
import { makeCompany, makeClient } from '@/test/fixtures';
import { useInactiveCompanyData } from './useInactiveCompanyData';
import { permissionValue } from '@/test/permissionGrants';
import { createDeferred } from '@/test/createDeferred';

function payload(companyId: string, name: string) {
  return {
    ...createEmptyAppData(),
    accounts: [makeCompany({ id: companyId })],
    clients: [
      buildInternalClient(companyId, '2026-01-01T00:00:00.000Z'),
      makeClient({
        id: `client-${companyId}`,
        companyId,
        name,
        color: '#2d75da',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        archivedAt: '2026-01-01T00:00:00.000Z',
      }),
    ],
  };
}

function Probe() {
  const { data } = useInactiveCompanyData();
  return <div>{data?.clients.map((client) => client.name).join(',') ?? 'hidden'}</div>;
}

function view(
  role: 'owner' | 'admin' | 'editor',
  principalId = 'bruce',
  permissions = permissionValue(role, 'resolved'),
) {
  return (
    <AuthContext.Provider
      value={{
        user: { id: principalId },
        refreshAuth: async () => {},
        signOut: async () => {},
      }}
    >
      <PermissionContext.Provider value={permissions}>
        <Probe />
      </PermissionContext.Provider>
    </AuthContext.Provider>
  );
}

beforeEach(() => {
  useStore.setState({ activeCompanyId: 'a1' });
});

afterEach(() => vi.unstubAllGlobals());

describe('useInactiveCompanyData', () => {
  it('reads inactive rows under the key the server checks, not the anonymise key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => payload('a1', 'Gotham') });
    vi.stubGlobal('fetch', fetchMock);
    const admin = permissionValue('admin', 'resolved');
    const permissions = {
      ...admin,
      grant: {
        ...admin.grant,
        permissions: admin.grant.permissions.filter((key) => key !== 'resources:anonymise'),
      },
    };
    render(view('admin', 'bruce', permissions));
    expect(await screen.findByText(/Gotham/)).toBeInTheDocument();
  });

  it('invalidates its private server set after a lifecycle mutation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload('a1', 'First') })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => payload('a1', 'Refreshed'),
      });
    vi.stubGlobal('fetch', fetchMock);
    render(view('admin'));
    expect(await screen.findByText(/First/)).toBeInTheDocument();
    notifyInactiveDataChanged('a1');
    expect(await screen.findByText(/Refreshed/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not reveal an old admin response after an editor role transition', async () => {
    const first = createDeferred<{
      ok: boolean;
      status: number;
      json: () => Promise<ReturnType<typeof payload>>;
    }>();
    const second = createDeferred<{
      ok: boolean;
      status: number;
      json: () => Promise<ReturnType<typeof payload>>;
    }>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.stubGlobal('fetch', fetchMock);
    const rendered = render(view('admin'));
    rendered.rerender(view('editor'));
    first.resolve({ ok: true, status: 200, json: async () => payload('a1', 'Stale') });
    await waitFor(() => expect(screen.getByText('hidden')).toBeInTheDocument());
    rendered.rerender(view('admin'));
    expect(screen.getByText('hidden')).toBeInTheDocument();
    second.resolve({ ok: true, status: 200, json: async () => payload('a1', 'Fresh') });
    expect(await screen.findByText(/Fresh/)).toBeInTheDocument();
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });

  it('does not reuse account A data while A is being refetched after A → B → A', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload('a1', 'Old A') })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload('a2', 'B') })
        .mockReturnValueOnce(new Promise(() => undefined)),
    );
    render(view('admin'));
    expect(await screen.findByText(/Old A/)).toBeInTheDocument();
    useStore.setState({ activeCompanyId: 'a2' });
    expect(await screen.findByText('Internal,B')).toBeInTheDocument();
    useStore.setState({ activeCompanyId: 'a1' });
    await waitFor(() => expect(screen.getByText('hidden')).toBeInTheDocument());
    expect(screen.queryByText('Old A')).not.toBeInTheDocument();
  });
  it('hides Owner labels immediately on Admin demotion and same-company principal replacement', async () => {
    const next = createDeferred<{
      ok: boolean;
      status: number;
      json: () => Promise<ReturnType<typeof payload>>;
    }>();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => payload('a1', 'Owner secret'),
        })
        .mockReturnValue(next.promise),
    );
    const rendered = render(view('owner'));
    expect(await screen.findByText(/Owner secret/)).toBeInTheDocument();
    rendered.rerender(view('admin'));
    expect(screen.getByText('hidden')).toBeInTheDocument();
    rendered.rerender(view('admin', 'diana'));
    expect(screen.getByText('hidden')).toBeInTheDocument();
    next.resolve({ ok: true, status: 200, json: async () => payload('a1', 'Safe cover') });
    expect(await screen.findByText(/Safe cover/)).toBeInTheDocument();
    expect(screen.queryByText(/Owner secret/)).not.toBeInTheDocument();
  });
});
