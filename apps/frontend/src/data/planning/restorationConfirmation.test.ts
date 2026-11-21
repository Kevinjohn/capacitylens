import { getMasqueradeContextToken } from '@/api/masqueradeContext';
import { createStore } from 'zustand/vanilla';
import { describe, expect, it, vi } from 'vitest';
import { makeCompany } from '@/test/fixtures';
import { createPlanningCache, createPlanningCacheState } from './planningCache';
import { PlanningCacheError } from './planningErrors';
import type { PlanningCacheState, PlanningTransport } from './planningCacheTypes';
import { emptyCapacity } from '@/test/capacityFixtures';
import { makePlanningAccess } from '@/test/planning/planningAccessFixtures';

const context = { identity: 'bruce', companyId: 'wayne' };
const intent = {
  operation: 'catalogue.update',
  entity: { entity: 'projects', id: 'gotham', changes: { codeName: 'Night' } },
} as const;
function harness(confirm?: (count: number, signal: AbortSignal) => Promise<boolean>) {
  const store = createStore<PlanningCacheState>(() => createPlanningCacheState());
  const execute = vi
    .fn<PlanningTransport['execute']>()
    .mockRejectedValueOnce(
      new PlanningCacheError(
        'This change clears 3 restorable items',
        'RESTORATION_CONFIRMATION_REQUIRED',
        409,
        false,
        3,
      ),
    )
    .mockImplementation(async (_context, execution) => ({
      status: 'committed',
      mutationId: execution.mutationId,
      revision: 1,
      restoration: { consumedGroupId: null, replacementGroupId: null },
      changes: { upserts: [], removed: [] },
    }));
  const cache = createPlanningCache({
    readMasqueradeContextToken: getMasqueradeContextToken,
    getState: store.getState,
    setState: store.setState,
    transport: {
      execute,
      undo: vi.fn(),
      redo: vi.fn(),
      read: async () => ({
        revision: 0,
        authority: makePlanningAccess(),
        data: {
          ...createPlanningCacheState().data,
          accounts: [makeCompany({ id: context.companyId })],
        },
        today: '2026-06-03',
        capacity: emptyCapacity(),
      }),
    },
    ...(confirm ? { confirmRestorationCleanup: confirm } : {}),
  });
  cache.setContext(context);
  return { cache, store, execute };
}

describe('restoration cleanup confirmation', () => {
  it('cancels without changing data or history', async () => {
    const confirm = vi.fn(async () => false);
    const h = harness(confirm);
    await h.cache.refresh();
    const before = h.store.getState();
    const draft = h.cache.begin();
    expect(await h.cache.execute(draft, intent)).toBeNull();
    expect(h.store.getState()).toEqual(before);
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(3, expect.any(AbortSignal));
  });
  it('confirms once using the original identity, intent and revision plus exact count', async () => {
    const confirm = vi.fn(async () => true);
    const h = harness(confirm);
    await h.cache.refresh();
    await h.cache.execute(h.cache.begin(), intent);
    expect(h.execute).toHaveBeenCalledTimes(2);
    const initial = h.execute.mock.calls[0]?.[1];
    expect(initial).toBeDefined();
    expect(h.execute.mock.calls[1]?.[1]).toEqual({ ...initial, confirmedRestorationCount: 3 });
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it('fails closed without a dialog callback and never automatically asks twice', async () => {
    const closed = harness();
    await closed.cache.refresh();
    await expect(closed.cache.execute(closed.cache.begin(), intent)).rejects.toMatchObject({
      code: 'RESTORATION_CONFIRMATION_REQUIRED',
    });
    expect(closed.execute).toHaveBeenCalledTimes(1);
    const confirm = vi.fn(async () => true);
    const h = harness(confirm);
    h.execute.mockReset();
    h.execute.mockRejectedValue(
      new PlanningCacheError('The count changed.', 'RESTORATION_CONFIRMATION_STALE', 409, false, 2),
    );
    // First refusal carries the original exact count; the confirmed retry receives the changed count.
    h.execute.mockRejectedValueOnce(
      new PlanningCacheError(
        'Confirm cleanup.',
        'RESTORATION_CONFIRMATION_REQUIRED',
        409,
        false,
        3,
      ),
    );
    await h.cache.refresh();
    await expect(h.cache.execute(h.cache.begin(), intent)).rejects.toMatchObject({
      code: 'RESTORATION_CONFIRMATION_STALE',
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(h.execute).toHaveBeenCalledTimes(2);
  });
  it('refuses malformed non-positive confirmation counts without opening a dialog', async () => {
    const confirm = vi.fn(async () => true);
    const h = harness(confirm);
    h.execute
      .mockReset()
      .mockRejectedValue(
        new PlanningCacheError(
          'Invalid count.',
          'RESTORATION_CONFIRMATION_REQUIRED',
          409,
          false,
          -1,
        ),
      );
    await h.cache.refresh();
    await expect(h.cache.execute(h.cache.begin(), intent)).rejects.toMatchObject({
      code: 'RESTORATION_CONFIRMATION_REQUIRED',
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
  it('keeps a newer canonical revision observed while confirmation was open', async () => {
    let cancel!: (value: boolean) => void;
    const confirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          cancel = resolve;
        }),
    );
    const h = harness(confirm);
    await h.cache.refresh();
    const pending = h.cache.execute(h.cache.begin(), intent);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    h.store.setState((current) => ({ planning: { ...current.planning, revision: 7 } }));
    cancel(false);
    expect(await pending).toBeNull();
    expect(h.store.getState().planning).toMatchObject({
      revision: 7,
      phase: { kind: 'ready', lastWrite: null },
    });
  });
  it('cannot replay after context changes while the dialog is open', async () => {
    let accept!: (value: boolean) => void;
    const confirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const h = harness(confirm);
    await h.cache.refresh();
    const pending = h.cache.execute(h.cache.begin(), intent);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    h.cache.setContext(null);
    accept(true);
    await expect(pending).rejects.toThrow();
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.store.getState().planning.context).toBeNull();
  });
});
