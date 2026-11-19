import type { PlanningPendingMutation } from '@/data/planning/planningCacheTypes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MasqueradeBootstrapStatus } from './masqueradeApi';
import { deferred, renderFreshProvider, makeMeResponse } from './AuthProvider.testSupport';
import { SessionProbe } from '@/test/SessionProbe';

const authBootstrapMocks = vi.hoisted(() => ({
  masqueradeStatus: vi.fn<() => Promise<MasqueradeBootstrapStatus>>(async () => ({
    active: false,
    contextToken: 'idle',
  })),
}));
vi.mock('./masqueradeApi', () => ({
  masqueradeApi: { status: authBootstrapMocks.masqueradeStatus },
}));

afterEach(() => {
  authBootstrapMocks.masqueradeStatus
    .mockReset()
    .mockResolvedValue({ active: false, contextToken: 'idle' });
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Pass the hook as a prop so reset module instances do not split context identity.
// Exercise fire-and-forget refresh because callers rely on its never-reject contract.
function RefreshProbe({
  useAuth,
}: {
  useAuth: () => {
    user: { id: string } | null;
    refreshAuth: () => Promise<void>;
  };
}) {
  const { user, refreshAuth } = useAuth();
  return (
    <button type="button" onClick={() => void refreshAuth()}>
      refresh<span>{`user:${user?.id ?? 'none'}`}</span>
    </button>
  );
}

describe('AuthProvider — server mode', () => {
  it('re-checks on planning 401 and swaps to the login screen when the session is gone', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeMeResponse(200, {
          user: { id: 'u1', email: 'a@b.test' },
        }),
      )
      .mockResolvedValue(makeMeResponse(401, {}));
    vi.stubGlobal('fetch', fetchSpy);
    const { AuthProvider, useStore } = await renderFreshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByText('app-content')).toBeInTheDocument();

    act(() =>
      useStore.setState((state) => ({
        planningAuthLossVersion: state.planningAuthLossVersion + 1,
      })),
    );
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
  it('warns on the login screen when a mid-session 401 strands unsaved writes', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeMeResponse(200, {
          user: { id: 'u1', email: 'a@b.test' },
        }),
      )
      .mockResolvedValue(makeMeResponse(401, {}));
    vi.stubGlobal('fetch', fetchSpy);
    const { AuthProvider, useStore, resetStoreWithCompany } = await renderFreshProvider();
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByText('app-content')).toBeInTheDocument();

    await resetStoreWithCompany();
    useStore.setState((state) => ({
      planning: {
        ...state.planning,
        phase: { kind: 'writing', write: {} as PlanningPendingMutation, readError: null },
      },
    }));

    act(() =>
      useStore.setState((state) => ({
        planningAuthLossVersion: state.planningAuthLossVersion + 1,
      })),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Some changes could not be saved before your session expired. They will not be restored after you sign in again.',
    );
    expect(screen.queryByText('app-content')).not.toBeInTheDocument();
  });
  it('planning 401 re-check that CANNOT resolve /me keeps the live authenticated snapshot (warns, no flip to auth-off)', async () => {
    // An unresolved auth re-check must preserve the current session snapshot so an outage cannot remove sign-out controls or change membership affordances.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeMeResponse(200, {
          user: { id: 'u1', email: 'a@b.test' },
        }),
      )
      .mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchSpy);
    const { AuthProvider, useStore, useAuth } = await renderFreshProvider();
    render(
      <AuthProvider>
        <SessionProbe useAuth={useAuth} />
      </AuthProvider>,
    );
    expect(await screen.findByText('user:u1')).toBeInTheDocument();
    act(() =>
      useStore.setState((state) => ({
        planningAuthLossVersion: state.planningAuthLossVersion + 1,
      })),
    );
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('refresh failed; keeping the previous auth snapshot'),
      ),
    );

    expect(screen.getByText('user:u1')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
  it('a STALE refreshAuth resolving after a newer 401 does not overwrite the login status', async () => {
    // A newer confirmed sign-out must win over an earlier authenticated response, or stale credentials would reopen the protected app.
    const slow = deferred<Response>();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeMeResponse(200, {
          user: { id: 'u1', email: 'a@b.test' },
        }),
      )
      .mockImplementationOnce(() => slow.promise)
      .mockResolvedValue(makeMeResponse(401, {}));
    vi.stubGlobal('fetch', fetchSpy);
    const { AuthProvider, useStore, useAuth } = await renderFreshProvider();
    render(
      <AuthProvider>
        <RefreshProbe useAuth={useAuth} />
      </AuthProvider>,
    );
    expect(await screen.findByRole('button', { name: /refresh/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /refresh/ }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    act(() =>
      useStore.setState((state) => ({
        planningAuthLossVersion: state.planningAuthLossVersion + 1,
      })),
    );
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    await act(async () => {
      slow.resolve(
        makeMeResponse(200, {
          user: { id: 'u1', email: 'a@b.test' },
        }),
      );
      await slow.promise;
    });

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh/ })).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe('AuthProvider auth state', () => {
  it('refreshAuth rechecks the session while preserving the verified identity', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeMeResponse(200, {
          user: { id: 'setup-owner', email: 'owner@example.test' },
        }),
      )
      .mockResolvedValue(
        makeMeResponse(200, {
          user: { id: 'setup-owner', email: 'owner@example.test' },
        }),
      );
    vi.stubGlobal('fetch', fetchSpy);
    const { AuthProvider, useAuth } = await renderFreshProvider();
    render(
      <AuthProvider>
        <RefreshProbe useAuth={useAuth} />
      </AuthProvider>,
    );
    expect(await screen.findByText('user:setup-owner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh/ }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(screen.getByText('user:setup-owner')).toBeInTheDocument();
  });
  it('a FAILED refresh keeps the previous (stale) snapshot with a warn breadcrumb — no crash, no reset', async () => {
    // An unresolved refresh must preserve the last verified session snapshot.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeMeResponse(200, {
          user: { id: 'setup-owner', email: 'owner@example.test' },
        }),
      )
      .mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchSpy);
    const { AuthProvider, useAuth } = await renderFreshProvider();
    render(
      <AuthProvider>
        <RefreshProbe useAuth={useAuth} />
      </AuthProvider>,
    );
    expect(await screen.findByText('user:setup-owner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh/ }));
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('refresh failed; keeping the previous auth snapshot'),
      ),
    );

    expect(screen.getByText('user:setup-owner')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
