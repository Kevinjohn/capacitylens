import { expect, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { PlanningIntent, PlanningMutationSuccess } from '@/api/planningContracts';
import { makeAccount, makeAppData, makeClient } from '@/test/fixtures';
import {
  createPlanningCacheController,
  createPlanningCacheState,
} from '@/data/planning/planningCacheController';
import type {
  PlanningCacheState,
  PlanningControllerOptions,
  PlanningSnapshot,
  PlanningTransport,
} from '@/data/planning/planningCacheController';

// Shared setup for the planning cache controller transition tests.

export const context = { identity: 'bruce-session', companyId: 'wayne' };
export const update: PlanningIntent = {
  operation: 'allocation.update',
  id: 'allocation-1',
  changes: { startDate: '2026-10-21' },
};
export const inverse: PlanningIntent = {
  operation: 'allocation.update',
  id: 'allocation-1',
  changes: { startDate: '2026-10-20' },
};

export function snapshot(revision: number, clientName = 'Wayne Enterprises'): PlanningSnapshot {
  return {
    revision,
    canWrite: true,
    accessKey: 'owner',
    data: makeAppData({
      accounts: [makeAccount({ id: 'wayne', name: 'Wayne Enterprises' })],
      clients: [makeClient({ id: 'client-1', accountId: 'wayne', name: clientName })],
    }),
  };
}

export function receipt(
  mutationId: string,
  revision: number,
  overrides: Partial<PlanningMutationSuccess> = {},
): PlanningMutationSuccess {
  return {
    status: 'committed',
    mutationId,
    revision,
    restoration: { consumedGroupId: null, replacementGroupId: null },
    projection: { mode: 'patch', history: 'retain', changed: { upserts: [], removed: [] } },
    ...overrides,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export type Options = Pick<PlanningControllerOptions, 'onAuthLoss' | 'confirmRestorationCleanup'>;

export function setup(options: Options = {}) {
  const store = createStore<PlanningCacheState>(() => createPlanningCacheState());
  const server = { revision: 1 };
  const read = vi.fn<PlanningTransport['read']>(async () => snapshot(server.revision));
  const execute = vi.fn<PlanningTransport['execute']>(async (_context, execution) => {
    server.revision = execution.baseRevision + 1;
    return receipt(execution.mutationId, server.revision);
  });
  const lookup = vi.fn<PlanningTransport['lookup']>();
  let id = 0;
  const controller = createPlanningCacheController({
    getState: store.getState,
    setState: store.setState,
    transport: { read, execute, lookup },
    createMutationId: () => `mutation-${++id}`,
    ...options,
  });
  const state = () => store.getState();
  return { store, state, server, read, execute, lookup, controller };
}

export async function ready(options: Options = {}) {
  const h = setup(options);
  h.controller.setContext(context);
  await expect(h.controller.refresh()).resolves.toBe(true);
  return h;
}

/** Ready at revision 2 with one acknowledged Undo entry. */
export async function readyWithHistory(options: Options = {}) {
  const h = await ready(options);
  await h.controller.execute(h.controller.begin({}), update, inverse);
  expect(h.state().planning.history.past).toHaveLength(1);
  expect(h.state().planning.revision).toBe(2);
  return h;
}

export async function uncertain() {
  const h = await ready();
  h.execute.mockRejectedValueOnce(new TypeError('response lost'));
  await expect(h.controller.execute(h.controller.begin({}), update, inverse)).rejects.toMatchObject(
    { uncertain: true },
  );
  expect(h.state().planning.status).toBe('uncertain');
  return h;
}
