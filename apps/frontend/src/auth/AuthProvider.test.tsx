import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { MasqueradeBootstrapStatus } from './masqueradeApi';
import { AUTH_INVALIDATION_STORAGE_KEY } from './signOut';
import { renderFreshProvider, makeMeResponse } from './AuthProvider.testSupport';
import { createDeferred } from '@/test/createDeferred';

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

describe('AuthProvider — server mode', () => {
  it('signals tenant-data access only after a successful auth check', async () => {
    const auth = createDeferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => auth.promise),
    );
    const onTenantAccessReady = vi.fn();
    const { AuthProvider } = await renderFreshProvider();
    render(
      <AuthProvider onTenantAccessReady={onTenantAccessReady}>
        <div>app-content</div>
      </AuthProvider>,
    );

    expect(onTenantAccessReady).not.toHaveBeenCalled();
    expect(screen.queryByText('app-content')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session…');

    await act(async () => {
      auth.resolve(
        makeMeResponse(200, {
          user: {
            id: 'authenticated-user',
            name: 'Authenticated user',
            email: 'authenticated@example.test',
          },
        }),
      );
    });

    expect(await screen.findByText('app-content')).toBeInTheDocument();
    await waitFor(() => expect(onTenantAccessReady).toHaveBeenCalledOnce());
  });
  it('hides tenant data immediately when a sibling tab signs out, then rechecks the session', async () => {
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
    const { queryClient } = await import('@/api/queryClient');
    render(
      <AuthProvider>
        <div>tenant-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByText('tenant-content')).toBeInTheDocument();
    queryClient.setQueryData(['private-account'], 'sensitive data');
    useStore.setState({ activeCompanyId: 'a-studio' });

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: AUTH_INVALIDATION_STORAGE_KEY,
          newValue: crypto.randomUUID(),
        }),
      );
    });

    expect(useStore.getState().activeCompanyId).toBeNull();
    expect(queryClient.getQueryData(['private-account'])).toBeUndefined();
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session…');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
  it('does not signal tenant-data access for a signed-out boot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeMeResponse(401, {})),
    );
    const onTenantAccessReady = vi.fn();
    const { AuthProvider } = await renderFreshProvider();
    render(
      <AuthProvider onTenantAccessReady={onTenantAccessReady}>
        <div>app-content</div>
      </AuthProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(onTenantAccessReady).not.toHaveBeenCalled();
    expect(screen.queryByText('app-content')).not.toBeInTheDocument();
  });
  it('refreshes a visible selected company every minute and stops after unmount', async () => {
    const fetchSpy = vi.fn(async () =>
      makeMeResponse(200, {
        user: { id: 'u1', email: 'a@b.test' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const { AuthProvider, useStore } = await renderFreshProvider();
    const refreshPlanning = vi.fn(async () => true);
    let tick: () => void = () => {
      throw new Error('Expected a visible-session refresh timer.');
    };
    const setInterval = vi.spyOn(window, 'setInterval').mockImplementation((handler, delay) => {
      if (delay === 60_000 && typeof handler === 'function') tick = handler as () => void;
      return 123 as unknown as ReturnType<typeof window.setInterval>;
    });
    const clearInterval = vi.spyOn(window, 'clearInterval').mockImplementation(() => {});
    const mounted = render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>,
    );
    expect(await screen.findByText('app-content')).toBeInTheDocument();
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    useStore.setState({ activeCompanyId: 'a-studio', refreshPlanning });
    refreshPlanning.mockClear();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    try {
      await act(async () => {
        tick();
      });
      expect(refreshPlanning).toHaveBeenCalledOnce();
      visibility.mockReturnValue('hidden');
      await act(async () => {
        tick();
      });
      expect(refreshPlanning).toHaveBeenCalledOnce();
      visibility.mockReturnValue('visible');
      useStore.setState({ activeCompanyId: null });
      refreshPlanning.mockClear();
      await act(async () => {
        tick();
      });
      expect(refreshPlanning).not.toHaveBeenCalled();
      mounted.unmount();
      expect(clearInterval).toHaveBeenCalledWith(123);
    } finally {
      setInterval.mockRestore();
      clearInterval.mockRestore();
    }
  });
  it.each([
    [
      { emailVerified: false, admission: { admitted: false, requirements: {} } },
      'access-verify-email',
    ],
    [{ emailVerified: true, admission: { admitted: false, requirements: {} } }, 'access-admission'],
    [
      {
        emailVerified: true,
        admission: { admitted: true, requirements: {} },
        membershipRequired: true,
      },
      'access-membership',
    ],
  ])(
    'holds a signed-in identity on its limited screen until every gate passes (%o)',
    async (gates, screenId) => {
      const onTenantAccessReady = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            makeMeResponse(200, { user: { id: 'u1', email: 'a@b.test' }, ...gates }),
          ),
      );
      const { AuthProvider } = await renderFreshProvider();
      render(
        <AuthProvider onTenantAccessReady={onTenantAccessReady}>
          <div>app-content</div>
        </AuthProvider>,
      );
      expect(await screen.findByTestId(screenId)).toBeInTheDocument();
      expect(screen.queryByText('app-content')).not.toBeInTheDocument();
      expect(onTenantAccessReady).not.toHaveBeenCalled();
    },
  );
});
