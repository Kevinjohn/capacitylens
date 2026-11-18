import { describe, expect, it } from 'vitest';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import { isPlanningHistoryReady } from './planningReadiness';
import { update, receipt, deferred, readyWithHistory } from '@/test/planningTransitionHarness';

// Pins the coordinator transitions that no other controller test asserts directly.

describe('planning history transitions', () => {
  it('refuses Undo and Redo while a write is unresolved or the server reports no step', async () => {
    const h = await readyWithHistory();
    await expect(h.controller.undo()).resolves.toBe(true);
    expect(h.state().planning.history).toEqual({ canUndo: false, canRedo: true });
    await expect(h.controller.redo()).resolves.toBe(true);
    expect(h.state().planning.history).toEqual({ canUndo: true, canRedo: false });

    const response = deferred<PlanningMutationSuccess>();
    h.execute.mockImplementationOnce(() => response.promise);
    const write = h.controller.execute(h.controller.begin(), update);
    await expect(h.controller.undo()).resolves.toBe(false);
    await expect(h.controller.redo()).resolves.toBe(false);
    expect(isPlanningHistoryReady(h.state().planning, 'undo')).toBe(false);
    // The server commits this change without adding it to the page's history, as it does for a
    // change it cannot reverse, so its next read reports nothing to undo.
    h.server.revision = 5;
    response.resolve(receipt('mutation-4', 5));
    await write;
    expect(h.state().planning.revision).toBe(5);
    expect(h.state().planning.history).toEqual({ canUndo: false, canRedo: false });
    await expect(h.controller.undo()).resolves.toBe(false);
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.redo).toHaveBeenCalledTimes(1);
  });
});
