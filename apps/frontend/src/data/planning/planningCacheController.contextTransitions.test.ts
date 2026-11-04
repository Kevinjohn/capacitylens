import { describe, expect, it } from 'vitest';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { PlanningSnapshot } from './planningCacheController';
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
    expect(h.state().planning.history.past).toHaveLength(1);
    expect(h.state().data.clients).toHaveLength(1);
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
    expect(h.state().planning).toMatchObject({ status: 'idle', revision: null, context: null });
    expect(h.state().data).toEqual(emptyAppData());
  });

  it('returns false without a read while no client context is installed', async () => {
    const h = setup();
    await expect(h.controller.refresh()).resolves.toBe(false);
    await expect(h.controller.reconcile()).resolves.toBe(false);
    await expect(h.controller.undo()).resolves.toBe(false);
    expect(h.read).not.toHaveBeenCalled();
    expect(h.state().planning.status).toBe('idle');
    expect(() => h.controller.begin({})).toThrow(/read-only/);
  });

  it('resets to ready at the imported revision and ignores a read started before a demo import', async () => {
    const h = await readyWithHistory();
    const read = deferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => read.promise);
    const refreshing = h.controller.refresh();
    const signal = h.read.mock.calls.at(-1)?.[1];
    const planning = h.controller.invalidateAfterDemoImport(context, 9);
    expect(signal?.aborted).toBe(true);
    h.store.setState(() => ({ planning }));
    read.resolve(snapshot(2, 'Pre-import name'));
    await expect(refreshing).resolves.toBe(false);
    expect(h.state().planning).toMatchObject({
      status: 'ready',
      revision: 9,
      canWrite: true,
      pending: null,
      outcome: null,
      history: { past: [], future: [], tipRevision: null },
    });
    await expect(h.controller.undo()).resolves.toBe(false);
  });
});
