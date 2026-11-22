import { getMasqueradeToken } from '@/api/masqueradeToken';
import { expect, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { PlanningIntent } from '@/api/planningContracts';
import { makeCompany, makeAppData, makeClient } from '@/test/fixtures';
import { createPlanningCache, createPlanningCacheState } from '@/data/planning/planningCache';
import type {
  FullPlanningSnapshot,
  PlanningCacheState,
  PlanningCacheOptions,
  PlanningTransport,
} from '@/data/planning/planningCacheTypes';
import { emptyCapacity } from '@/test/capacityFixtures';
import { makeReceipt } from '@/test/planning/makeReceipt';
import { createServerHistoryModel } from '@/test/planning/serverHistoryModel';
import { makePlanningAccess } from '@/test/planning/planningAccessFixtures';

export { makeReceipt };

// Shared setup for the planning cache transition tests.

export const context = { identity: 'bruce-session', companyId: 'wayne' };
export const update: PlanningIntent = {
  operation: 'allocation.update',
  id: 'allocation-1',
  changes: { startDate: '2026-10-21' },
};

export function snapshot(
  revision: number,
  clientName = 'Wayne Enterprises',
  history = { canUndo: false, canRedo: false },
): FullPlanningSnapshot {
  return {
    revision,
    access: makePlanningAccess(),
    data: makeAppData({
      companies: [makeCompany({ id: 'wayne', name: 'Wayne Enterprises' })],
      clients: [makeClient({ id: 'client-1', companyId: 'wayne', name: clientName })],
    }),
    today: '2026-06-03',
    capacity: emptyCapacity(),
    history,
  };
}

export type Options = Pick<PlanningCacheOptions, 'onAuthLoss' | 'confirmRestorationCleanup'>;

export function setup(options: Options = {}) {
  const store = createStore<PlanningCacheState>(() => createPlanningCacheState());
  const server = { revision: 1, history: createServerHistoryModel() };
  const read = vi.fn<PlanningTransport['read']>(async (_context, _signal, request) =>
    snapshot(
      server.revision,
      undefined,
      server.history.report(request?.historyId, server.revision),
    ),
  );
  const execute = vi.fn<PlanningTransport['execute']>(async (_context, execution) => {
    server.revision = execution.baseRevision + 1;
    server.history.committed(execution.historyId, execution.baseRevision, server.revision);
    return makeReceipt(execution.mutationId, server.revision);
  });
  const stepper = (kind: 'undo' | 'redo') =>
    vi.fn<PlanningTransport['undo']>(async (_context, step) => {
      if (step.baseRevision !== server.revision) {
        throw Object.assign(new Error('The planning data changed.'), {
          code: 'STALE_REVISION',
          status: 409,
        });
      }
      server.history.step(kind, step.historyId, server.revision, server.revision + 1);
      server.revision += 1;
      return makeReceipt(step.mutationId, server.revision);
    });
  const undo = stepper('undo');
  const redo = stepper('redo');
  let id = 0;
  let historyNumber = 0;
  const cache = createPlanningCache({
    readMasqueradeToken: getMasqueradeToken,
    getState: store.getState,
    setState: store.setState,
    transport: { read, execute, undo, redo },
    createMutationId: () => `mutation-${++id}`,
    createHistoryId: () => `history-${++historyNumber}`,
    ...options,
  });
  const state = () => store.getState();
  return { store, state, server, read, execute, undo, redo, cache };
}

export async function ready(options: Options = {}) {
  const h = setup(options);
  h.cache.setContext(context);
  await expect(h.cache.refresh()).resolves.toBe(true);
  return h;
}

/** Ready at revision 2 with one change the server reports as undoable. */
export async function readyWithHistory(options: Options = {}) {
  const h = await ready(options);
  await h.cache.execute(h.cache.begin(), update);
  expect(h.state().planning.history).toEqual({ canUndo: true, canRedo: false });
  expect(h.state().planning.revision).toBe(2);
  return h;
}
