import { describe, expect, it } from 'vitest';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import { isPlanningHistoryReady } from './planningReadiness';
import { update, makeReceipt, readyWithHistory } from '@/test/planningTransitionHarness';
import { createDeferred } from '@/test/createDeferred';

// Pins the coordinator transitions that no other cache test asserts directly.

describe('planning history transitions', () => {
  it('refuses Undo and Redo while a write is unresolved or the server reports no step', async () => {
    const h = await readyWithHistory();
    await expect(h.cache.undo()).resolves.toBe(true);
    expect(h.state().planning.history).toEqual({ canUndo: false, canRedo: true });
    await expect(h.cache.redo()).resolves.toBe(true);
    expect(h.state().planning.history).toEqual({ canUndo: true, canRedo: false });

    const response = createDeferred<PlanningMutationSuccess>();
    h.execute.mockImplementationOnce(() => response.promise);
    const write = h.cache.execute(h.cache.begin(), update);
    await expect(h.cache.undo()).resolves.toBe(false);
    await expect(h.cache.redo()).resolves.toBe(false);
    expect(isPlanningHistoryReady(h.state().planning, 'undo')).toBe(false);
    // The server commits this change without adding it to the page's history, as it does for a
    // change it cannot reverse, so its next read reports nothing to undo.
    h.server.revision = 5;
    response.resolve(makeReceipt('mutation-4', 5));
    await write;
    expect(h.state().planning.revision).toBe(5);
    expect(h.state().planning.history).toEqual({ canUndo: false, canRedo: false });
    await expect(h.cache.undo()).resolves.toBe(false);
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.redo).toHaveBeenCalledTimes(1);
  });
});
