import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PermissionProvider } from './PermissionProvider';
import { AuthContext } from './authContext';
import type { AuthContextValue } from './authContext';
import { useCanEdit, useCompanyAccess, usePermissionStatus, useRole } from './permissionContext';
import {
  makeAccount,
  makeAppData,
  makeResourceDraft,
  resetStoreWithAccount,
} from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { useAccountSummaries } from './useAccountSummaries';
import * as accountTransition from './accountTransition';
import type { MasqueradeStatus } from '@capacitylens/shared/domain/masquerade';
import { isAccountRole } from '@capacitylens/shared/account/types';
import { authorityFixture } from '@/test/authorityFixture';

const permissionMocks = vi.hoisted(() => ({
  masqueradeStatus: vi.fn<() => Promise<MasqueradeStatus>>(async () => ({
    active: false,
    contextToken: 'idle',
  })),
}));
vi.mock('./masqueradeApi', () => ({
  masqueradeApi: { status: permissionMocks.masqueradeStatus },
}));

const auth: AuthContextValue = {
  authMode: 'password-only',
  user: { id: 'u1' },
  canCreateAccount: false,
  refreshAuth: async () => {},
  signOut: async () => {},
};

function Probe() {
  const role = useRole();
  const status = usePermissionStatus();
  const editable = useCanEdit();
  const access = useCompanyAccess();
  return (
    <>
      <div>{`${status}:${role ?? 'none'}:${editable ? 'edit' : 'read'}`}</div>
      <div data-testid="permissions">{access?.permissions.join(',') ?? 'none'}</div>
    </>
  );
}

function PrincipalTree({ userId }: { userId: string }) {
  return (
    <AuthContext.Provider value={{ ...auth, user: { id: userId } }}>
      <PermissionProvider>
        <Probe />
      </PermissionProvider>
    </AuthContext.Provider>
  );
}

function renderProvider() {
  return render(
    <AuthContext.Provider value={auth}>
      <PermissionProvider>
        <Probe />
      </PermissionProvider>
    </AuthContext.Provider>,
  );
}

function SharedDirectoryProvider() {
  useAccountSummaries({ refreshActiveAccount: false });
  return (
    <PermissionProvider>
      <Probe />
    </PermissionProvider>
  );
}

function renderSharedDirectoryProvider() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthContext.Provider value={auth}>
        <SharedDirectoryProvider />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function accountResponse(id: string, role: string) {
  const access = isAccountRole(role) ? { access: authorityFixture(role, id) } : {};
  return new Response(
    JSON.stringify([
      { id, name: id === 'a-studio' ? 'Wayne Enterprises' : 'Stark Industries', role, ...access },
    ]),
    {
      status: 200,
    },
  );
}

function addSecondAccount() {
  useStore.getState().replaceAll(
    makeAppData({
      accounts: [
        makeAccount({ id: 'acct-test' }),
        makeAccount({ id: 'a-studio', name: 'Wayne Enterprises' }),
      ],
    }),
  );
  useStore.getState().setActiveAccount('acct-test');
}

beforeEach(async () => {
  permissionMocks.masqueradeStatus
    .mockReset()
    .mockResolvedValue({ active: false, contextToken: 'idle' });
  await resetStoreWithAccount();
  useStore.setState({ masquerade: { kind: 'inactive' } });
  vi.stubEnv('VITE_CAPACITYLENS_DEMO', '');
});

afterEach(() => {
  useStore.setState({ masquerade: { kind: 'inactive' } });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('PermissionProvider authenticated lookup posture', () => {
  it('uses the active target role without requesting account membership', async () => {
    useStore.setState({
      activeAccountId: 'a-studio',
      masquerade: {
        kind: 'active',
        generation: 4,
        state: {
          accountId: 'a-studio',
          targetUserId: 'u-viewer',
          targetName: 'Selina Kyle',
          effectiveRole: 'viewer',
          startedAt: '2026-09-01T10:00:00.000Z',
          expiresAt: '2999-09-01T10:15:00.000Z',
          token: 'session-token',
        },
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderProvider();

    expect(await screen.findByText('resolved:viewer:read')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(permissionMocks.masqueradeStatus).not.toHaveBeenCalled();
  });

  it('is read-only immediately while role lookup is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderProvider();

    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument();
    await waitFor(() => expect(useStore.getState().activeRole).toBe('viewer'));
    expect(useStore.getState().activeRoleStatus).toBe('pending');
  });

  it('stays read-only when role lookup fails or returns malformed data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderProvider();

    expect(await screen.findByText('unavailable:viewer:read')).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe('viewer');
    expect(useStore.getState().activeRoleStatus).toBe('unavailable');
  });
});

describe('PermissionProvider refresh behavior', () => {
  it('enables editing only after a concrete write-tier role resolves', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(accountResponse('acct-test', 'editor')));
    renderProvider();

    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument();
    expect(await screen.findByText('resolved:editor:edit')).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe('editor');
  });
});

describe('PermissionProvider membership invalidation', () => {
  it('starts the directory read only after status resolves and adopts status before publishing the role', async () => {
    let resolveStatus!: (status: { active: false; contextToken: string }) => void;
    permissionMocks.masqueradeStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );
    const fetchMock = vi.fn().mockResolvedValue(accountResponse('acct-test', 'owner'));
    vi.stubGlobal('fetch', fetchMock);
    const adoptStatus = vi.spyOn(accountTransition, 'adoptMasqueradeStatus');
    const setActiveAuthority = vi.spyOn(useStore.getState(), 'setActiveAuthority');

    renderProvider();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useStore.getState().activeRoleStatus).toBe('pending');
    await waitFor(() => expect(permissionMocks.masqueradeStatus).toHaveBeenCalledOnce());
    resolveStatus({ active: false, contextToken: 'idle' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(await screen.findByText('resolved:owner:edit')).toBeInTheDocument();

    const resolvedRoleCall = setActiveAuthority.mock.calls.findIndex(
      ([{ role, status, access }]) => role === 'owner' && status === 'resolved' && access !== null,
    );
    expect(resolvedRoleCall).toBeGreaterThanOrEqual(0);
    const resolvedRoleInvocationOrder =
      setActiveAuthority.mock.invocationCallOrder[resolvedRoleCall];
    if (resolvedRoleInvocationOrder === undefined) {
      throw new Error('resolved role call was not recorded');
    }
    expect(adoptStatus.mock.invocationCallOrder[0]).toBeLessThan(resolvedRoleInvocationOrder);
  });
});

describe('PermissionProvider membership generation', () => {
  it('re-resolves the active role when a membership mutation invalidates its projections', async () => {
    let role = 'owner';
    const fetchMock = vi.fn(async () => accountResponse('acct-test', role));
    vi.stubGlobal('fetch', fetchMock);
    renderProvider();

    expect(await screen.findByText('resolved:owner:edit')).toBeInTheDocument();
    role = 'admin';
    act(() => useStore.getState().invalidateMemberships());

    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument();
    expect(await screen.findByText('resolved:admin:edit')).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe('admin');
    expect(useStore.getState().activeAccess?.role).toBe('admin');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one account-directory read per membership generation with the shell hook', async () => {
    let role = 'owner';
    const fetchMock = vi.fn(async () => accountResponse('acct-test', role));
    vi.stubGlobal('fetch', fetchMock);
    renderSharedDirectoryProvider();

    expect(await screen.findByText('resolved:owner:edit')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    role = 'admin';
    act(() => useStore.getState().invalidateMemberships());

    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument();
    expect(await screen.findByText('resolved:admin:edit')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('PermissionProvider account-switch safety', () => {
  it('fails closed in context and store immediately after switching from an owner account', async () => {
    addSecondAccount();
    const b = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(accountResponse('acct-test', 'owner'))
        .mockImplementationOnce(() => b.promise),
    );
    renderProvider();

    expect(await screen.findByText('resolved:owner:edit')).toBeInTheDocument();
    act(() => useStore.getState().setActiveAccount('a-studio'));

    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe('viewer');
    expect(useStore.getState().activeRoleStatus).toBe('pending');

    await act(async () => b.resolve(accountResponse('a-studio', 'editor')));
    expect(await screen.findByText('resolved:editor:edit')).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe('editor');
    expect(useStore.getState().activeRoleStatus).toBe('resolved');
  });

  it("does not adopt an old account's delayed masquerade status after a switch", async () => {
    addSecondAccount();
    const aStatus = deferred<{ active: false; contextToken: string }>();
    permissionMocks.masqueradeStatus
      .mockImplementationOnce(() => aStatus.promise)
      .mockResolvedValueOnce({ active: false, contextToken: 'idle' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(accountResponse('a-studio', 'editor')));
    const adoptStatus = vi.spyOn(accountTransition, 'adoptMasqueradeStatus');
    renderProvider();

    await waitFor(() => expect(permissionMocks.masqueradeStatus).toHaveBeenCalledOnce());
    act(() => useStore.getState().setActiveAccount('a-studio'));
    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument();
    expect(await screen.findByText('resolved:editor:edit')).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe('editor');

    await act(async () => aStatus.resolve({ active: false, contextToken: 'idle' }));
    expect(adoptStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByText('resolved:editor:edit')).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe('editor');
  });

  it('ignores a delayed active status after a local controller transition', async () => {
    await resetStoreWithAccount('a-studio');
    let resolveStatus!: (status: MasqueradeStatus) => void;
    permissionMocks.masqueradeStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { masqueradeController } = await import('./masqueradeController');
    const inactiveProjection = useStore.getState().masquerade;
    const adoptStatus = vi.spyOn(accountTransition, 'adoptMasqueradeStatus');
    renderProvider();

    await waitFor(() => expect(permissionMocks.masqueradeStatus).toHaveBeenCalledOnce());
    act(() => {
      masqueradeController.invalidate();
      useStore.setState({ masquerade: inactiveProjection });
    });
    await act(async () =>
      resolveStatus({
        active: true,
        accountId: 'a-studio',
        targetUserId: 'u-viewer',
        targetName: 'Selina Kyle',
        effectiveRole: 'viewer',
        startedAt: '2026-09-01T10:00:00.000Z',
        expiresAt: '2026-09-01T10:15:00.000Z',
        token: 'stale-mode-token',
        contextToken: 'stale-mode-token',
      }),
    );

    expect(adoptStatus).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useStore.getState().masquerade).toBe(inactiveProjection);
  });
});

describe('PermissionProvider stale directory safety', () => {
  it("keeps B authoritative when A's delayed directory response resolves later", async () => {
    addSecondAccount();
    const a = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => a.promise)
      .mockResolvedValueOnce(accountResponse('a-studio', 'admin'));
    vi.stubGlobal('fetch', fetchMock);
    renderProvider();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    act(() => useStore.getState().setActiveAccount('a-studio'));
    expect(await screen.findByText('resolved:admin:edit')).toBeInTheDocument();
    await act(async () => a.resolve(accountResponse('acct-test', 'owner')));

    expect(screen.getByText('resolved:admin:edit')).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe('admin');
    expect(useStore.getState().activeRoleStatus).toBe('resolved');
  });

  it("does not let a stale A directory rejection overwrite B's role", async () => {
    addSecondAccount();
    const a = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => a.promise)
      .mockResolvedValueOnce(accountResponse('a-studio', 'owner'));
    vi.stubGlobal('fetch', fetchMock);
    renderProvider();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    act(() => useStore.getState().setActiveAccount('a-studio'));
    expect(await screen.findByText('resolved:owner:edit')).toBeInTheDocument();
    await act(async () => a.reject(new Error('A timed out')));

    expect(screen.getByText('resolved:owner:edit')).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe('owner');
    expect(useStore.getState().activeRoleStatus).toBe('resolved');
  });
});

describe('PermissionProvider fail-closed responses', () => {
  it('fails closed for an absent or malformed active membership and clears only after a complete list proves absence', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(accountResponse('other', 'owner'))
        .mockResolvedValueOnce(accountResponse('acct-test', 'unknown-role')),
    );
    renderProvider();

    await waitFor(() => expect(useStore.getState().activeAccountId).toBeNull());
    expect(screen.getByText('not-applicable:none:read')).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBeNull();
    expect(useStore.getState().activeRoleStatus).toBe('not-applicable');

    act(() => useStore.getState().setActiveAccount('acct-test'));
    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument();
    expect(await screen.findByText('unavailable:viewer:read')).toBeInTheDocument();
    expect(useStore.getState().activeAccountId).toBe('acct-test');
    expect(useStore.getState().activeRole).toBe('viewer');
    expect(useStore.getState().activeRoleStatus).toBe('unavailable');
  });

  it('does not request permissions in off, demo, or null-account modes', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const offView = render(
      <AuthContext.Provider value={{ ...auth, authMode: 'off' }}>
        <PermissionProvider>
          <Probe />
        </PermissionProvider>
      </AuthContext.Provider>,
    );
    expect(screen.getByText('not-applicable:none:read')).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBeNull();
    expect(useStore.getState().activeRoleStatus).toBe('not-applicable');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(permissionMocks.masqueradeStatus).not.toHaveBeenCalled();

    vi.stubEnv('VITE_CAPACITYLENS_DEMO', '1');
    const demoView = renderProvider();
    // Demo mode evaluates Owner-level capability; the server-mode off view stays read-only.
    expect(screen.getByText('not-applicable:none:edit')).toBeInTheDocument();
    expect(screen.getByText('not-applicable:none:read')).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(permissionMocks.masqueradeStatus).not.toHaveBeenCalled();

    offView.unmount();
    demoView.unmount();
    vi.stubEnv('VITE_CAPACITYLENS_DEMO', '');
    act(() => useStore.getState().setActiveAccount(null));
    renderProvider();
    expect(screen.getByText('not-applicable:none:read')).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBeNull();
    expect(useStore.getState().activeRoleStatus).toBe('not-applicable');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(permissionMocks.masqueradeStatus).not.toHaveBeenCalled();
  });
});

describe('PermissionProvider authority snapshot', () => {
  it('clears capabilities before the fetch resolves when the principal changes on the same company', async () => {
    const second = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(accountResponse('acct-test', 'owner'))
        .mockImplementationOnce(() => second.promise),
    );
    const view = render(<PrincipalTree userId="u-bruce" />);
    expect(await screen.findByText('resolved:owner:edit')).toBeInTheDocument();

    view.rerender(<PrincipalTree userId="u-selina" />);

    expect(screen.getByText('pending:viewer:read')).toBeInTheDocument();
    expect(screen.getByTestId('permissions')).toHaveTextContent('none');
    expect(useStore.getState().activeAccess).toBeNull();
    await act(async () => second.resolve(accountResponse('acct-test', 'viewer')));
    expect(await screen.findByText('resolved:viewer:read')).toBeInTheDocument();
  });

  it("ignores a previous principal's delayed response after a principal switch", async () => {
    const first = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(accountResponse('acct-test', 'viewer'));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<PrincipalTree userId="u-bruce" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    view.rerender(<PrincipalTree userId="u-selina" />);
    expect(await screen.findByText('resolved:viewer:read')).toBeInTheDocument();
    await act(async () => first.resolve(accountResponse('acct-test', 'owner')));

    expect(screen.getByText('resolved:viewer:read')).toBeInTheDocument();
    expect(useStore.getState().activeRole).toBe('viewer');
    expect(useStore.getState().activeAccess?.permissions).not.toContain('planning:write');
  });

  it('projects read-only access when the masquerade generation changes, despite a late summary', async () => {
    const summary = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => summary.promise),
    );
    renderProvider();
    await waitFor(() => expect(permissionMocks.masqueradeStatus).toHaveBeenCalledOnce());

    act(() =>
      useStore.setState({
        masquerade: {
          kind: 'active',
          generation: 7,
          state: {
            accountId: 'acct-test',
            targetUserId: 'u-diana',
            targetName: 'Diana Prince',
            effectiveRole: 'owner',
            startedAt: '2026-09-01T10:00:00.000Z',
            expiresAt: '2999-09-01T10:15:00.000Z',
            token: 'context-proof',
          },
        },
      }),
    );
    await act(async () => summary.resolve(accountResponse('acct-test', 'owner')));

    expect(screen.getByText('resolved:owner:read')).toBeInTheDocument();
    expect(screen.getByTestId('permissions')).toHaveTextContent(/^planning:read$/);
    expect(useStore.getState().activeAccess?.permissions).toEqual(['planning:read']);
  });

  it('blocks store writes while the authority lookup is unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderProvider();
    expect(await screen.findByText('unavailable:viewer:read')).toBeInTheDocument();

    await useStore.getState().addResource(makeResourceDraft({ name: 'Blocked' }));

    expect(useStore.getState().data.resources).toHaveLength(0);
    expect(useStore.getState().notice?.message).toMatch(/role could not be verified/i);
  });
});
