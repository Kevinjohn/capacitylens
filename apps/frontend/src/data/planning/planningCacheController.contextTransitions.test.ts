import { describe, expect, it } from 'vitest';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { PlanningSnapshot } from './planningCacheTypes';
import {
  context,
  snapshot,
  deferred,
  setup,
  ready,
  readyWithHistory,
} from '@/test/planningTransitionHarness';

// Pins the coordinator transitions that no other controller test asserts directly.

describe('planning context transitions', () => {
  it('keeps rows, history and an in-flight read when an equal context is installed again', async () => {
    const h = await readyWithHistory();
    const read = deferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => read.promise);
    const refreshing = h.controller.refresh();
    const signal = h.read.mock.calls.at(-1)?.[1];
    h.controller.setContext({ ...context });
    expect(signal?.aborted).toBe(false);
    read.resolve(snapshot(2));
    await expect(refreshing).resolves.toBe(true);
    expect(h.state().data.clients).toHaveLength(1);
    // The page kept its history id, so the server still reports its change as undoable.
    await expect(h.controller.refresh()).resolves.toBe(true);
    expect(h.state().planning.history.canUndo).toBe(true);
  });

  it('aborts in-flight requests when the context is cleared', async () => {
    const h = await ready();
    const read = deferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => read.promise);
    const refreshing = h.controller.refresh();
    const signal = h.read.mock.calls.at(-1)?.[1];
    h.controller.setContext(null);
    expect(signal?.aborted).toBe(true);
    read.resolve(snapshot(5));
    await expect(refreshing).resolves.toBe(false);
    expect(h.state().planning).toMatchObject({
      phase: { kind: 'idle' },
      revision: null,
      context: null,
    });
    expect(h.state().data).toEqual(emptyAppData());
  });

  it('returns false without a read while no client context is installed', async () => {
    const h = setup();
    await expect(h.controller.refresh()).resolves.toBe(false);
    await expect(h.controller.undo()).resolves.toBe(false);
    expect(h.read).not.toHaveBeenCalled();
    expect(h.state().planning.phase.kind).toBe('idle');
    expect(() => h.controller.begin()).toThrow(/read-only/);
  });
});
