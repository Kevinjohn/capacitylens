import { describe, expect, it } from 'vitest';
import type { PlanningIntent, PlanningMutationSuccess } from '@/api/planningContracts';
import { isPlanningHistoryReady } from './planningCacheController';
import {
  update,
  inverse,
  receipt,
  deferred,
  ready,
  readyWithHistory,
} from '@/test/planningTransitionHarness';

// Pins the coordinator transitions that no other controller test asserts directly.

describe('planning history transitions', () => {
  it('refuses Undo and Redo while a write is unresolved or the history tip is behind', async () => {
    const h = await readyWithHistory();
    await h.controller.undo();
    expect(h.state().planning.history.future).toHaveLength(1);
    await h.controller.redo();
    expect(h.state().planning.history.past).toHaveLength(1);

    const response = deferred<PlanningMutationSuccess>();
    h.execute.mockImplementationOnce(() => response.promise);
    const write = h.controller.execute(h.controller.begin({}), update, inverse);
    await expect(h.controller.undo()).resolves.toBe(false);
    await expect(h.controller.redo()).resolves.toBe(false);
    h.server.revision = 5;
    response.resolve(receipt('mutation-4', 5));
    await write;
    const calls = h.execute.mock.calls.length;

    h.store.setState((state) => ({
      planning: {
        ...state.planning,
        history: { ...state.planning.history, tipRevision: (state.planning.revision ?? 0) - 1 },
      },
    }));
    expect(h.state().planning.history.past.length).toBeGreaterThan(0);
    await expect(h.controller.undo()).resolves.toBe(false);
    expect(isPlanningHistoryReady(h.state().planning)).toBe(false);
    expect(h.execute).toHaveBeenCalledTimes(calls);
  });

  it('clears both histories when Undo of a create commits without a restoration handle', async () => {
    const h = await readyWithHistory();
    const create = {
      operation: 'allocation.repeat',
      sourceAllocationId: 'allocation-1',
      occurrences: [{ id: 'allocation-2', startDate: '2026-10-21', endDate: '2026-10-21' }],
    } as PlanningIntent;
    const remove: PlanningIntent = { operation: 'allocation.deleteGroup', ids: ['allocation-2'] };
    await h.controller.execute(h.controller.begin({}), create, remove);
    expect(h.state().planning.history.past).toHaveLength(2);
    await expect(h.controller.undo()).resolves.toBe(true);
    expect(h.execute.mock.calls.at(-1)?.[1].intent).toEqual(remove);
    expect(h.state().planning.history).toEqual({ past: [], future: [], tipRevision: null });
  });

  it('clears history when Redo of a delete commits without a fresh restoration handle', async () => {
    const h = await ready();
    const remove: PlanningIntent = { operation: 'allocation.delete', id: 'allocation-1' };
    const restore: PlanningIntent = { operation: 'planning.restoreGroup', restorationGroupId: '' };
    h.execute.mockImplementationOnce(async (_context, execution) => {
      h.server.revision = 2;
      return receipt(execution.mutationId, 2, {
        restoration: { consumedGroupId: null, replacementGroupId: 'group-1' },
      });
    });
    await h.controller.execute(h.controller.begin({}), remove, restore);
    expect(h.state().planning.history.past.at(-1)?.inverse).toEqual({
      operation: 'planning.restoreGroup',
      restorationGroupId: 'group-1',
    });
    await expect(h.controller.undo()).resolves.toBe(true);
    expect(h.state().planning.history.future).toHaveLength(1);
    await expect(h.controller.redo()).resolves.toBe(true);
    expect(h.execute.mock.calls.at(-1)?.[1].intent).toEqual(remove);
    expect(h.state().planning.history).toEqual({ past: [], future: [], tipRevision: null });
  });

  it('turns Undo of a catalogue create into an unarchive Redo with the same entity', async () => {
    const h = await ready();
    const create = {
      operation: 'catalogue.create',
      entity: { entity: 'clients', id: 'client-2', fields: { name: 'Daily Planet' } },
    } as PlanningIntent;
    const archive = {
      operation: 'catalogue.archive',
      entity: { entity: 'clients', id: 'client-2' },
    } as PlanningIntent;
    await h.controller.execute(h.controller.begin({}), create, archive);
    await expect(h.controller.undo()).resolves.toBe(true);
    expect(h.state().planning.history.future).toEqual([
      {
        forward: {
          operation: 'catalogue.unarchive',
          entity: { entity: 'clients', id: 'client-2' },
        },
        inverse: archive,
      },
    ]);
    await expect(h.controller.redo()).resolves.toBe(true);
    expect(h.execute.mock.calls.at(-1)?.[1].intent).toEqual({
      operation: 'catalogue.unarchive',
      entity: { entity: 'clients', id: 'client-2' },
    });
    expect(h.state().planning.history.past.at(-1)?.inverse).toEqual(archive);
  });
});
