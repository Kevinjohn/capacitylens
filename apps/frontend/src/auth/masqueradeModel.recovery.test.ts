import { setMasqueradeToken } from '@/api/masqueradeToken';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MasqueradeState, MasqueradeStatus } from '@capacitylens/shared/domain/masquerade';
import { makeCompany, makeAppData, requireFullSnapshot } from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import type { PlanningPendingMutation } from '@/data/planning/planningCacheTypes';
import { StubPlanningTransport } from '@/test/planning/stubPlanningTransport';
import { getStubPlanningTransport } from '@/test/planningTransportHandle';
import { reprojectAccess } from './reprojectAccess';
import { MasqueradeModel } from './masqueradeModel';
import { viewAsGrantFor } from '@/test/permissionGrants';

const reads = vi.hoisted(() => ({ fail: false, count: 0 }));

vi.mock('@/data/planning/storePlanningTransport', async () => {
  const actual = await vi.importActual<typeof import('@/test/createTestPlanningTransport')>(
    '@/test/createTestPlanningTransport',
  );
  return {
    createStorePlanningTransport: () => {
      return actual.createTestPlanningTransport((transport) => ({
        ...transport,
        read: async (...args: Parameters<typeof transport.read>) => {
          reads.count += 1;
          if (reads.fail) throw new Error('Canonical planning read failed');
          return transport.read(...args);
        },
      }));
    },
  };
});

const state: MasqueradeState & { contextToken: string } = {
  companyId: 'a-studio',
  targetUserId: 'u-viewer',
  targetName: 'Selina Kyle',
  effectiveRole: 'viewer',
  ...viewAsGrantFor('viewer'),
  startedAt: '2026-09-01T10:00:00.000Z',
  expiresAt: '2026-09-01T10:15:00.000Z',
  token: 'token-1',
  contextToken: 'token-1',
};
const inactiveStatus = { active: false as const, contextToken: 'idle-context' };

function modelWithNativeData(bootstrapFailure = false) {
  const nativeData = makeAppData({
    accounts: [makeCompany({ id: state.companyId, name: 'Wayne Enterprises' })],
  });
  useStore.setState({ data: nativeData });
  getStubPlanningTransport().reset(state.companyId, nativeData);
  const bootstrapTransport = new StubPlanningTransport();
  bootstrapTransport.reset(state.companyId, nativeData);
  const api = {
    status: vi.fn(async (): Promise<MasqueradeStatus> => inactiveStatus),
    start: vi.fn(async () => state),
    end: vi.fn(async () => {}),
  };
  const switchCompany = vi.fn(async (companyId: string | null) => {
    useStore.getState().setActiveCompany(companyId);
    return { kind: 'reloaded' as const };
  });
  const model = new MasqueradeModel({
    flush: vi.fn(async () => ({ kind: 'clean' as const })),
    suspend: () => useStore.getState().suspendPlanningIntents(),
    reproject: reprojectAccess,
    readBootstrapCompany: async (companyId) => {
      if (bootstrapFailure) throw new Error('Bootstrap company read failed');
      const snapshot = requireFullSnapshot(
        await bootstrapTransport.read(
          { companyId, identity: 'bootstrap' },
          new AbortController().signal,
        ),
      );
      return snapshot.data.accounts.find((candidate) => candidate.id === companyId)?.name ?? null;
    },
    switchCompany,
    api,
    readState: () => useStore.getState(),
    setMasqueradeToken,
  });
  return { model, api, switchCompany };
}

it('keeps a failed bootstrap read gated while allowing a confirmed cold End', async () => {
  const { model, api, switchCompany } = modelWithNativeData(true);
  await model.adoptStatus({ active: true, ...state });
  expect(useStore.getState().activeCompanyId).toBeNull();
  expect(useStore.getState().masquerade.kind).toBe('starting');
  expect(await model.end()).toBe(true);
  expect(api.end).toHaveBeenCalledExactlyOnceWith(state.token, 'explicit');
  expect(switchCompany).toHaveBeenCalledExactlyOnceWith(null);
  expect(useStore.getState().masquerade.kind).toBe('inactive');
});

beforeEach(() => {
  reads.fail = false;
  reads.count = 0;
  useStore.getState().clearPlanning();
  useStore.getState().setActiveCompany(null);
  useStore.getState().setMasquerade({ kind: 'inactive' });
});

afterEach(() => {
  reads.fail = false;
});

async function failSelectedCanonicalRead(model: MasqueradeModel) {
  reads.fail = true;
  await model.adoptStatus({ active: true, ...state });
  expect(useStore.getState().activeCompanyId).toBe('a-studio');
  expect(useStore.getState().planning).toMatchObject({
    phase: { kind: 'failed' },
    revision: null,
  });
  expect(useStore.getState().masquerade.kind).toBe('starting');
  expect(reads.count).toBeGreaterThan(0);
}

it("recovers a selected company after its canonical read fails, but refuses another owner's lock", async () => {
  const { model, api } = modelWithNativeData();
  await failSelectedCanonicalRead(model);
  const foreignRelease = useStore.getState().suspendPlanningIntents();
  expect(foreignRelease).toBeTypeOf('function');
  const beforeBlockedRetry = reads.count;
  expect(await model.retryProjection()).toBe(false);
  expect(await model.end()).toBe(false);
  expect(reads.count).toBe(beforeBlockedRetry);
  expect(api.end).not.toHaveBeenCalled();
  expect(useStore.getState().masquerade.kind).toBe('starting');
  foreignRelease?.();

  reads.fail = false;
  expect(await model.retryProjection()).toBe(true);
  expect(useStore.getState().masquerade.kind).toBe('active');
  expect(useStore.getState().planning.phase.kind).toBe('ready');
});

it('ends a selected cold member view even while canonical reads keep failing', async () => {
  const { model, api, switchCompany } = modelWithNativeData();
  await failSelectedCanonicalRead(model);
  expect(await model.end()).toBe(true);
  expect(api.end).toHaveBeenCalledExactlyOnceWith(state.token, 'explicit');
  expect(switchCompany).toHaveBeenCalledExactlyOnceWith(null);
  expect(useStore.getState().masquerade.kind).toBe('inactive');
  expect(useStore.getState().activeCompanyId).toBeNull();
});

it('refuses recovery while a typed mutation remains unresolved', async () => {
  const { model, api } = modelWithNativeData();
  await failSelectedCanonicalRead(model);
  const write = { execution: { mutationId: 'pending' } } as PlanningPendingMutation;
  useStore.setState((current) => ({
    planning: { ...current.planning, phase: { kind: 'writing', write, readError: null } },
  }));
  const before = reads.count;
  expect(await model.retryProjection()).toBe(false);
  expect(await model.end()).toBe(false);
  expect(reads.count).toBe(before);
  expect(api.end).not.toHaveBeenCalled();
  expect(useStore.getState().masquerade.kind).toBe('starting');
});
