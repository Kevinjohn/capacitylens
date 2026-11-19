import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MasqueradeBootstrapStatus } from './masqueradeApi';
import { freshProvider, me } from './AuthProvider.testSupport';
import { SessionProbe } from '@/test/SessionProbe';
import { viewAsGrantFor } from '@/test/permissionGrants';

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
  it('bootstraps an active masquerade from its validated real principal without calling auth/me', async () => {
    authBootstrapMocks.masqueradeStatus.mockResolvedValue({
      active: true,
      companyId: 'a-studio',
      targetUserId: 'target-user',
      targetName: 'Selina Kyle',
      effectiveRole: 'viewer',
      ...viewAsGrantFor('viewer'),
      startedAt: '2026-09-01T10:00:00.000Z',
      expiresAt: '2026-09-01T10:15:00.000Z',
      token: 'session-token',
      contextToken: 'session-token',
      principal: { id: 'real-principal', name: 'Bruce Wayne', email: 'bruce@example.test' },
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { AuthProvider, useAuth, useStore, resetStoreWithCompany } = await freshProvider();
    await resetStoreWithCompany('a-studio');

    render(
      <AuthProvider>
        <SessionProbe useAuth={useAuth} />
      </AuthProvider>,
    );

    expect(await screen.findByText('user:real-principal')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useStore.getState().activeCompanyId).toBe('a-studio');
    expect(useStore.getState().masquerade.kind).toBe('active');
  });

  it('bootstraps a cold active member view only after its scoped canonical company read', async () => {
    authBootstrapMocks.masqueradeStatus.mockResolvedValue({
      active: true,
      companyId: 'a-studio',
      targetUserId: 'target-user',
      targetName: 'Selina Kyle',
      effectiveRole: 'viewer',
      ...viewAsGrantFor('viewer'),
      startedAt: '2026-09-01T10:00:00.000Z',
      expiresAt: '2026-09-01T10:15:00.000Z',
      token: 'session-token',
      contextToken: 'session-token',
      principal: { id: 'real-principal', name: 'Bruce Wayne', email: 'bruce@example.test' },
    });
    vi.doMock('@/data/planning/storePlanningTransport', async () => {
      const { createPlanningTransport } = await import('@/data/planning/planningTransport');
      return { createStorePlanningTransport: () => createPlanningTransport() };
    });
    try {
      const { AuthProvider, useStore } = await freshProvider('server');
      const { makeCompany, makeAppData } = await import('@/test/fixtures');
      const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!url.includes('/api/companies/a-studio/planning')) {
          throw new Error(`Unexpected read: ${url}`);
        }
        return me(200, {
          companyId: 'a-studio',
          revision: 1,
          authority: {
            actorId: 'real-principal',
            effectiveActorId: 'target-user',
            role: 'viewer',
            canWrite: false,
            canSeePrivateNames: false,
            canSeeTimeOffNote: false,
          },
          data: makeAppData({
            accounts: [makeCompany({ id: 'a-studio', name: 'Wayne Enterprises' })],
          }),
          today: '2026-06-03',
        });
      });
      vi.stubGlobal('fetch', fetchSpy);
      expect(useStore.getState().activeCompanyId).toBeNull();
      expect(useStore.getState().companySummaries).toEqual([]);

      render(
        <AuthProvider>
          <div>member-content</div>
        </AuthProvider>,
      );

      expect(await screen.findByText('member-content')).toBeInTheDocument();
      expect(useStore.getState().activeCompanyId).toBe('a-studio');
      expect(useStore.getState().companySummaries).toEqual([
        { id: 'a-studio', name: 'Wayne Enterprises', role: 'viewer' },
      ]);
      expect(useStore.getState().masquerade.kind).toBe('active');
      expect(authBootstrapMocks.masqueradeStatus).toHaveBeenCalledWith(undefined);
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      vi.doMock('@/data/planning/storePlanningTransport', async () => {
        const { createTestPlanningTransport } = await import('@/test/createTestPlanningTransport');
        return { createStorePlanningTransport: createTestPlanningTransport };
      });
    }
  });
});
