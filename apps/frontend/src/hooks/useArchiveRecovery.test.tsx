import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Role } from '@capacitylens/shared/account/types';
import type { ArchiveRecovery } from '@capacitylens/shared/domain/lifecycle';
import { AuthContext } from '@/auth/authContext';
import { PermissionContext } from '@/auth/permissionContext';
import { useStore } from '@/store/useStore';
import { notifyInactiveDataChanged } from '@/data/inactiveDataEvents';
import { useArchiveRecovery } from './useArchiveRecovery';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/data/apiConfig', () => ({
  API_BASE: 'http://api.test',
  isServerConfigured: () => true,
}));
vi.mock('@/api/queryClient', async (original) => ({
  ...(await original<typeof import('@/api/queryClient')>()),
  client: { request },
}));
function payload(accountId: string, label: string): ArchiveRecovery {
  return {
    accountId,
    rows: [{ entity: 'clients', id: 'client', label, archived: true, parent: null }],
  };
}
function deferred() {
  let resolve!: (value: ArchiveRecovery) => void;
  const promise = new Promise<ArchiveRecovery>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Probe() {
  const { data, error } = useArchiveRecovery();
  return <div>{error ?? data?.rows.map((row) => row.label).join(',') ?? 'hidden'}</div>;
}
function view(cache: QueryClient, role: Role = 'editor', principal: string | null = 'bruce') {
  return (
    <QueryClientProvider client={cache}>
      <AuthContext.Provider
        value={{
          authMode: 'password-only',
          user: principal ? { id: principal } : null,
          canCreateAccount: true,
          refreshAuth: async () => {},
          signOut: async () => {},
        }}
      >
        <PermissionContext.Provider value={{ role, status: 'resolved' }}>
          <Probe />
        </PermissionContext.Provider>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}
function company(accountId: string) {
  useStore.setState((state) => ({
    activeAccountId: accountId,
    planning: {
      ...state.planning,
      context: { identity: 'principal', companyId: accountId },
      status: 'ready',
      revision: 0,
      canWrite: true,
      accessKey: JSON.stringify(['bruce', 'bruce', 'editor', true]),
    },
  }));
}
beforeEach(() => {
  request.mockReset();
  useStore.setState({ refreshPlanning: async () => true });
  company('a-studio');
});
describe('archive recovery request boundaries', () => {
  it('requests the generated identity route and refreshes after lifecycle changes', async () => {
    request
      .mockResolvedValueOnce(payload('a-studio', 'First'))
      .mockResolvedValueOnce(payload('a-studio', 'Second'));
    render(view(new QueryClient()));
    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(request.mock.calls[0]?.[0]).toBe('api.planning.archive');
    act(() => notifyInactiveDataChanged('a-studio'));
    expect(await screen.findByText('Second')).toBeInTheDocument();
    expect(request.mock.calls.every(([name]) => name === 'api.planning.archive')).toBe(true);
  });
  it('hides cached A synchronously on A → B → A and aborts obsolete reads', async () => {
    const pending = deferred();
    request
      .mockResolvedValueOnce(payload('a-studio', 'Old A'))
      .mockReturnValueOnce(pending.promise)
      .mockReturnValueOnce(new Promise(() => {}));
    render(view(new QueryClient()));
    expect(await screen.findByText('Old A')).toBeInTheDocument();
    act(() => company('a-loft'));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const args = request.mock.calls[1]?.[1] as { signal: AbortSignal };
    const signal = args.signal;
    act(() => company('a-studio'));
    expect(screen.getByText('hidden')).toBeInTheDocument();
    await act(async () => pending.resolve(payload('a-loft', 'Late B')));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText(/Old A|Late B/)).not.toBeInTheDocument();
  });
  it('discards Owner labels on role and same-company principal transitions', async () => {
    request
      .mockResolvedValueOnce(payload('a-studio', 'Owner secret'))
      .mockReturnValue(new Promise(() => {}));
    const cache = new QueryClient();
    useStore.setState((state) => ({
      planning: { ...state.planning, accessKey: JSON.stringify(['bruce', 'bruce', 'owner', true]) },
    }));
    const rendered = render(view(cache, 'owner'));
    expect(await screen.findByText('Owner secret')).toBeInTheDocument();
    rendered.rerender(view(cache, 'admin'));
    expect(screen.getByText('hidden')).toBeInTheDocument();
    rendered.rerender(view(cache, 'owner', 'diana'));
    expect(screen.queryByText('Owner secret')).not.toBeInTheDocument();
  });
  it('refuses Viewer reads and surfaces failed reloads without stale success', async () => {
    request
      .mockResolvedValueOnce(payload('a-studio', 'First'))
      .mockRejectedValueOnce(new Error('Archive read failed'));
    const cache = new QueryClient();
    const rendered = render(view(cache, 'viewer'));
    expect(request).not.toHaveBeenCalled();
    rendered.rerender(view(cache));
    expect(await screen.findByText('First')).toBeInTheDocument();
    act(() => notifyInactiveDataChanged('a-studio'));
    expect(await screen.findByText('Archive read failed')).toBeInTheDocument();
    expect(screen.queryByText('First')).not.toBeInTheDocument();
  });
  it('aborts a delayed response on sign-out and rejects it after a new projection', async () => {
    const late = deferred();
    request.mockReturnValue(late.promise);
    const cache = new QueryClient();
    const rendered = render(view(cache));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const args = request.mock.calls[0]?.[1] as { signal: AbortSignal };
    rendered.rerender(view(cache, 'editor', null));
    expect(screen.getByText('hidden')).toBeInTheDocument();
    await act(async () => late.resolve(payload('a-studio', 'Late identity')));
    expect(args.signal.aborted).toBe(true);
    expect(screen.queryByText('Late identity')).not.toBeInTheDocument();
    act(() =>
      useStore.setState((state) => ({ planning: { ...state.planning, status: 'loading' } })),
    );
    rendered.rerender(view(cache));
    expect(screen.getByText('hidden')).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
