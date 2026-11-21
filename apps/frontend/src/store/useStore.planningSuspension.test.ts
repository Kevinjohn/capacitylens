import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadPlanningData,
  makeCompany,
  makeResourceDraft,
  resetStoreWithCompany,
} from '@/test/fixtures';
import { requireCreated } from '@/test/requireCreated';
import { useStore } from './useStore';

beforeEach(async () => {
  await resetStoreWithCompany();
});

describe('planning intent suspension', () => {
  it('blocks a typed send, undo, and redo until its idempotent release', async () => {
    const resource = await requireCreated(useStore.getState().addResource(makeResourceDraft()));
    const activity = await requireCreated(
      useStore.getState().addActivity({ name: 'Operations', kind: 'internal' }),
    );
    const allocation = requireCreated(
      await useStore.getState().addAllocation({
        resourceId: resource.id,
        activityId: activity.id,
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        hoursPerDay: 8,
        status: 'confirmed',
      }),
    );
    const release = useStore.getState().suspendPlanningIntents();
    if (!release) throw new Error('The ready planning view did not acquire its replacement lock.');
    expect(useStore.getState().planningReadyForReplacement()).toBe(false);
    expect(useStore.getState().suspendPlanningIntents()).toBeNull();

    await expect(
      useStore.getState().updateAllocation(allocation.id, { endDate: '2026-06-03' }),
    ).rejects.toThrow(/suspended/);
    await expect(useStore.getState().undoPlanning()).resolves.toBe(false);
    await expect(useStore.getState().redoPlanning()).resolves.toBe(false);
    expect(
      useStore.getState().data.allocations.find((row) => row.id === allocation.id)?.endDate,
    ).toBe('2026-06-02');

    release();
    release();
    await expect(useStore.getState().undoPlanning()).resolves.toBe(true);
  });

  it('does not let an old company release unlock a later context incarnation', async () => {
    loadPlanningData({
      ...useStore.getState().data,
      accounts: [...useStore.getState().data.accounts, makeCompany({ id: 'a2' })],
    });
    const releaseA = useStore.getState().suspendPlanningIntents();
    if (!releaseA) throw new Error('Company A did not acquire its replacement lock.');
    useStore.getState().setActiveCompany('a2');
    await useStore.getState().refreshPlanning();
    const releaseB = useStore.getState().suspendPlanningIntents();
    if (!releaseB) throw new Error('Company B did not acquire its replacement lock.');
    releaseA();
    await expect(
      useStore.getState().sendPlanningIntent({
        intent: { operation: 'allocation.deleteGroup', ids: [] },
      }),
    ).rejects.toThrow(/suspended/);
    releaseB();
    useStore.getState().setActiveCompany('acct-test');
    await useStore.getState().refreshPlanning();
    const releaseSecondA = useStore.getState().suspendPlanningIntents();
    if (!releaseSecondA) throw new Error('The new company A incarnation did not acquire its lock.');
    releaseA();
    await expect(
      useStore.getState().sendPlanningIntent({
        intent: { operation: 'allocation.deleteGroup', ids: [] },
      }),
    ).rejects.toThrow(/suspended/);
    releaseSecondA();
  });

  it('retires a lock after context clear and requires a fresh directory and canonical read', async () => {
    loadPlanningData({
      ...useStore.getState().data,
      accounts: [...useStore.getState().data.accounts, makeCompany({ id: 'a2' })],
    });
    const releaseOldA = useStore.getState().suspendPlanningIntents();
    if (!releaseOldA) throw new Error('The first company A context was not ready.');
    useStore.getState().setActiveCompany(null);
    expect(useStore.getState().planning.context).toBeNull();
    expect(useStore.getState().data.accounts).toEqual([]);

    useStore.getState().setCompanySummaries({
      list: [
        { id: 'acct-test', name: 'Test Co', role: 'owner' },
        { id: 'a2', name: 'Test Co', role: 'owner' },
      ],
    });

    useStore.getState().setActiveCompany('acct-test');
    await useStore.getState().refreshPlanning();
    const releaseNewA = useStore.getState().suspendPlanningIntents();
    if (!releaseNewA) throw new Error('The re-entered company A context was not ready.');
    releaseOldA();
    expect(useStore.getState().planningReadyForReplacement()).toBe(false);
    releaseNewA();
    expect(useStore.getState().planningReadyForReplacement()).toBe(true);
  });

  it('refuses replacement until the canonical view is ready and resolved', () => {
    expect(useStore.getState().planningReadyForReplacement()).toBe(true);
    useStore.setState((state) => ({
      planning: { ...state.planning, phase: { kind: 'loading', lastWrite: null } },
    }));
    expect(useStore.getState().planningReadyForReplacement()).toBe(false);
    useStore.setState((state) => ({
      planning: { ...state.planning, phase: { kind: 'ready', lastWrite: null }, revision: null },
    }));
    expect(useStore.getState().planningReadyForReplacement()).toBe(false);
  });

  it('can claim an unsettled selected context for authority recovery without permitting an ordinary replacement', () => {
    useStore.setState((state) => ({
      planning: {
        ...state.planning,
        phase: { kind: 'failed', error: new Error('Read failed'), lastWrite: null },
        revision: null,
      },
    }));
    expect(useStore.getState().planningReadyForReplacement()).toBe(false);
    const releaseRecovery = useStore.getState().suspendPlanningIntents();
    if (!releaseRecovery) {
      throw new Error('The unsettled selected context could not be claimed for recovery.');
    }
    expect(useStore.getState().suspendPlanningIntents()).toBeNull();
    releaseRecovery();
    expect(useStore.getState().planningReadyForReplacement()).toBe(false);
  });

  it('refuses authority recovery while a typed mutation remains unresolved', () => {
    useStore.setState((state) => ({
      planning: {
        ...state.planning,
        phase: {
          kind: 'writing',
          write: {
            execution: {
              mutationId: 'pending-mutation',
              baseRevision: state.planning.revision ?? 0,
              intent: { operation: 'allocation.deleteGroup', ids: [] },
            },
            kind: 'new',
          },
          readError: null,
        },
      },
    }));

    expect(useStore.getState().suspendPlanningIntents()).toBeNull();
  });

  it('clears private planning rows even when the cache context is already null', () => {
    useStore.getState().clearPlanning();
    useStore.setState((state) => ({
      data: { ...state.data, accounts: [makeCompany()] },
      companySummaries: [{ id: 'acct-test', name: 'Test Co', role: 'owner' }],
    }));
    expect(useStore.getState().planning.context).toBeNull();

    useStore.getState().clearPlanning();

    expect(useStore.getState().data.accounts).toEqual([]);
    expect(useStore.getState().companySummaries).toEqual([]);
  });
});
