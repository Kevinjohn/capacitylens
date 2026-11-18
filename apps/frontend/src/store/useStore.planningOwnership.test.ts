import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanningControllerError } from '@/data/planning/planningErrors';
import { readPlanningProblem } from '@/data/planning/planningNotices';
import { useStore } from '@/store/useStore';
import {
  makeAccount,
  makeResourceDraft,
  replaceFixtureData,
  resetStoreWithAccount,
  updatePlanningFixtureSource,
} from '@/test/fixtures';
import { requireCreated } from '@/test/requireCreated';

// Lets a test make the planning transport fail like the server would.
const failure = vi.hoisted(() => ({
  read: null as Error | null,
  execute: null as Error | null,
  holdNextRead: null as Promise<void> | null,
  onHeldRead: null as (() => void) | null,
}));

vi.mock('@/data/planning/storePlanningTransport', async () => {
  const actual = await vi.importActual<typeof import('@/test/createTestPlanningTransport')>(
    '@/test/createTestPlanningTransport',
  );
  return {
    createStorePlanningTransport: () => {
      return actual.createTestPlanningTransport((transport) => ({
        ...transport,
        read: async (...args: Parameters<typeof transport.read>) => {
          if (failure.read) throw failure.read;
          const snapshot = await transport.read(...args);
          const hold = failure.holdNextRead;
          if (hold) {
            failure.holdNextRead = null;
            failure.onHeldRead?.();
            await hold;
          }
          return snapshot;
        },
        execute: (...args: Parameters<typeof transport.execute>) =>
          failure.execute ? Promise.reject(failure.execute) : transport.execute(...args),
      }));
    },
  };
});

async function seedTypedAllocation() {
  const resource = await requireCreated(useStore.getState().addResource(makeResourceDraft()));
  const activity = await requireCreated(
    useStore.getState().addActivity({ name: 'Operations', kind: 'internal' }),
  );
  return requireCreated(
    await useStore.getState().addAllocation({
      resourceId: resource.id,
      activityId: activity.id,
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      hoursPerDay: 8,
      status: 'confirmed',
    }),
  );
}

beforeEach(async () => {
  failure.read = null;
  failure.execute = null;
  failure.holdNextRead = null;
  failure.onHeldRead = null;
  await resetStoreWithAccount();
});

afterEach(() => {
  failure.read = null;
  failure.execute = null;
  failure.holdNextRead = null;
  failure.onHeldRead = null;
});

describe('planning authority publication', () => {
  it('clears the cache and typed planning history together when authentication is lost', async () => {
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Wayne Enterprises', color: '#111111' }),
    );
    expect(useStore.getState().data.clients).toContainEqual(
      expect.objectContaining({ id: client.id }),
    );
    await useStore.getState().refreshPlanning();
    await seedTypedAllocation();
    expect(useStore.getState().planning.history.past).toHaveLength(4);
    await useStore.getState().undoPlanning();
    expect(useStore.getState().planning.history.past).toHaveLength(3);
    expect(useStore.getState().planning.history.future).toHaveLength(1);

    failure.read = new PlanningControllerError('Sign in again.', undefined, 401);
    const beforeAuthLoss = useStore.getState().planningAuthLossVersion;
    await useStore.getState().refreshPlanning({ fresh: true });

    const state = useStore.getState();
    expect(state.data.allocations).toEqual([]);
    expect(state.data.clients).toEqual([]);
    expect(state.data.resources).toEqual([]);
    expect(state.planning.history.past).toEqual([]);
    expect(state.planning.history.future).toEqual([]);
    expect(state.planning.context).toBeNull();
    expect(state.activeAccountId).toBeNull();
    expect(state.planningAuthLossVersion).toBe(beforeAuthLoss + 1);
  });

  it('keeps rows and history and shows a refusal when a change loses company membership', async () => {
    const allocation = await seedTypedAllocation();
    const data = useStore.getState().data;
    const planningPast = useStore.getState().planning.history.past;
    const authLossVersion = useStore.getState().planningAuthLossVersion;
    failure.execute = new PlanningControllerError(
      'You no longer belong to this company.',
      'ACCOUNT_MEMBERSHIP_LOST',
      403,
    );

    await expect(
      useStore.getState().updateAllocation(allocation.id, { endDate: '2026-06-03' }),
    ).rejects.toThrow('You no longer belong to this company.');

    const state = useStore.getState();
    expect(state.data).toBe(data);
    expect(state.planning.history.past).toBe(planningPast);
    expect(state.planning.context).not.toBeNull();
    expect(state.activeAccountId).not.toBeNull();
    expect(state.planningAuthLossVersion).toBe(authLossVersion);
    expect(readPlanningProblem(state.planning)).toBe('refused');
  });

  it('shows the server state after a lost write and asks the person to check it', async () => {
    const allocation = await seedTypedAllocation();
    failure.execute = new TypeError('response lost');
    await expect(
      useStore.getState().updateAllocation(allocation.id, { endDate: '2026-06-03' }),
    ).rejects.toThrow('response lost');
    failure.execute = null;

    expect(useStore.getState().planning.status).toBe('ready');
    expect(readPlanningProblem(useStore.getState().planning)).toBe('unconfirmed');
    expect(
      useStore.getState().data.allocations.find((row) => row.id === allocation.id)?.endDate,
    ).toBe(allocation.endDate);
  });
});

describe('planning ownership of allocations', () => {
  it('opens the planning context for a company as soon as it becomes active', async () => {
    const data = {
      ...useStore.getState().data,
      accounts: [...useStore.getState().data.accounts, makeAccount({ id: 'a2' })],
    };
    replaceFixtureData(data);
    useStore.getState().setAccountSummaries({
      list: data.accounts.map((account) => ({ id: account.id, name: account.name, role: 'owner' })),
    });

    useStore.getState().setActiveAccount('a2');

    expect(useStore.getState().planning.context?.companyId).toBe('a2');
    await vi.waitFor(() => expect(useStore.getState().planning.status).toBe('ready'));
  });

  it('requires a post-change canonical read instead of reusing a held older projection', async () => {
    const oldClient = await requireCreated(
      useStore.getState().addClient({ name: 'Old actor', color: '#111111' }),
    );
    let releaseOld!: () => void;
    let held!: () => void;
    const oldReadHeld = new Promise<void>((resolve) => {
      held = resolve;
    });
    failure.holdNextRead = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    failure.onHeldRead = held;

    const beforeChange = useStore.getState().refreshPlanning();
    await oldReadHeld;
    useStore.setState((state) => ({
      data: { ...state.data, clients: state.data.clients.filter((row) => row.id !== oldClient.id) },
    }));
    updatePlanningFixtureSource(useStore.getState().data);
    const afterChange = useStore.getState().refreshPlanning({ fresh: true });
    expect(afterChange).not.toBe(beforeChange);
    expect(await afterChange).toBe(true);
    releaseOld();
    // The superseded read resolves with the newer read's outcome and never applies its own rows.
    expect(await beforeChange).toBe(true);
    expect(useStore.getState().data.clients.find((row) => row.id === oldClient.id)).toBeUndefined();
  });

  it('undoes the latest typed allocation edit without removing a preceding catalogue change', async () => {
    const allocation = await seedTypedAllocation();
    const client = await requireCreated(
      useStore.getState().addClient({ name: 'Wayne Enterprises', color: '#111111' }),
    );
    await useStore.getState().updateAllocation(allocation.id, { endDate: '2026-06-05' });

    await useStore.getState().undoPlanning();

    expect(useStore.getState().data.clients.find((row) => row.id === client.id)).toEqual(client);
    expect(
      useStore.getState().data.allocations.find((row) => row.id === allocation.id)?.endDate,
    ).toBe(allocation.endDate);
  });
});
