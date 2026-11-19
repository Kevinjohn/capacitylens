import { readPlanningError } from './planningNotices';
import { describe, expect, it } from 'vitest';
import { isPlanningHistoryReady } from './planningReadiness';
import { PlanningControllerError } from './planningErrors';
import { readPlanningProblem } from './planningNotices';
import type { PlanningSnapshot } from './planningCacheTypes';
import { snapshot, deferred, ready, readyWithHistory } from '@/test/planningTransitionHarness';

// Pins the coordinator transitions that no other controller test asserts directly.

/** What the server reports to this page after its one change. */
const undoable = { canUndo: true, canRedo: false };

describe('planning read transitions', () => {
  it('publishes loading during a background read and refuses a new change until it settles', async () => {
    const h = await readyWithHistory();
    const read = deferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => read.promise);
    const refreshing = h.controller.refresh();
    expect(h.state().planning.phase.kind).toBe('loading');
    expect(isPlanningHistoryReady(h.state().planning, 'undo')).toBe(false);
    expect(() => h.controller.begin()).toThrow(/not ready/);
    await expect(h.controller.undo()).resolves.toBe(false);
    read.resolve(snapshot(2, undefined, undoable));
    await refreshing;
    expect(h.state().planning.phase.kind).toBe('ready');
    expect(isPlanningHistoryReady(h.state().planning, 'undo')).toBe(true);
    expect(h.execute).toHaveBeenCalledOnce();
  });

  it('keeps a settled status through a quiet read, so a change can start meanwhile', async () => {
    const h = await readyWithHistory();
    const read = deferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => read.promise);
    const refreshing = h.controller.refresh({ quiet: true });
    expect(h.state().planning.phase.kind).toBe('ready');
    expect(isPlanningHistoryReady(h.state().planning, 'undo')).toBe(true);
    expect(() => h.controller.begin()).not.toThrow();
    read.resolve(snapshot(2, undefined, undoable));
    await expect(refreshing).resolves.toBe(true);
    expect(h.state().planning.phase.kind).toBe('ready');
  });

  it('surfaces a failed quiet read, and shows the next quiet read from that error as loading', async () => {
    const h = await readyWithHistory();
    h.read.mockRejectedValueOnce(new TypeError('read unavailable'));
    await expect(h.controller.refresh({ quiet: true })).resolves.toBe(false);
    expect(h.state().planning.phase.kind).toBe('failed');
    expect(readPlanningProblem(h.state().planning)).toBe('unavailable');

    const read = deferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => read.promise);
    const refreshing = h.controller.refresh({ quiet: true });
    expect(h.state().planning.phase.kind).toBe('loading');
    expect(readPlanningError(h.state().planning.phase)).toBeNull();
    read.resolve(snapshot(2, undefined, undoable));
    await expect(refreshing).resolves.toBe(true);
    expect(h.state().planning.phase.kind).toBe('ready');
  });

  it('surfaces a failed read as unavailable, keeps rows and history, and blocks writes until a read succeeds', async () => {
    const h = await readyWithHistory();
    h.read.mockRejectedValueOnce(new TypeError('read unavailable'));
    await expect(h.controller.refresh()).resolves.toBe(false);
    expect(h.state().planning.phase.kind).toBe('failed');
    expect(readPlanningProblem(h.state().planning)).toBe('unavailable');
    expect(h.state().data.clients[0]?.name).toBe('Wayne Enterprises');
    expect(h.state().planning.history.canUndo).toBe(true);
    expect(() => h.controller.begin()).toThrow(/not ready/);
    await expect(h.controller.undo()).resolves.toBe(false);

    await expect(h.controller.refresh()).resolves.toBe(true);
    expect(h.state().planning.phase.kind).toBe('ready');
    expect(readPlanningProblem(h.state().planning)).toBeNull();
    await expect(h.controller.undo()).resolves.toBe(true);
  });

  it('takes the company date from each same-revision read and keeps history', async () => {
    const h = await readyWithHistory();
    h.read.mockResolvedValueOnce({ ...snapshot(2, undefined, undoable), today: '2026-06-01' });
    await expect(h.controller.refresh()).resolves.toBe(true);
    expect(h.state().planning.today).toBe('2026-06-01');

    h.read.mockResolvedValueOnce({ ...snapshot(2, undefined, undoable), today: '2026-06-02' });
    await expect(h.controller.refresh()).resolves.toBe(true);
    expect(h.state().planning.today).toBe('2026-06-02');
    expect(h.state().planning.history.canUndo).toBe(true);
  });

  it('rejects an older snapshot under the same authority without replacing rows', async () => {
    const h = await ready();
    h.server.revision = 5;
    await h.controller.refresh();
    h.read.mockResolvedValueOnce(snapshot(4, 'Older Wayne name'));
    await expect(h.controller.refresh()).resolves.toBe(false);
    expect(h.state().planning.phase.kind).toBe('failed');
    expect(h.state().planning.revision).toBe(5);
    expect(readPlanningError(h.state().planning.phase)).toBeInstanceOf(PlanningControllerError);
    expect(h.state().data.clients[0]?.name).toBe('Wayne Enterprises');
  });

  it("resolves a read that a newer read supersedes with the newer read's outcome", async () => {
    const h = await ready();
    const first = deferred<PlanningSnapshot>();
    const second = deferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => first.promise);
    h.read.mockImplementationOnce(() => second.promise);
    const fresh = h.controller.refresh();
    const pan = h.controller.refresh({ quiet: true });
    first.resolve(snapshot(2, 'Stale Wayne name'));
    second.resolve(snapshot(2));
    await expect(fresh).resolves.toBe(true);
    await expect(pan).resolves.toBe(true);
    expect(h.state().data.clients[0]?.name).toBe('Wayne Enterprises');
  });

  it('aborts a read that a newer read supersedes, without showing an error', async () => {
    const h = await ready();
    const second = deferred<PlanningSnapshot>();
    let firstSignal: AbortSignal | undefined;
    h.read.mockImplementationOnce(
      (_context, signal) =>
        new Promise((_resolve, reject) => {
          firstSignal = signal;
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    h.read.mockImplementationOnce(() => second.promise);
    const fresh = h.controller.refresh();
    const pan = h.controller.refresh({ quiet: true });
    expect(firstSignal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.state().planning.phase.kind).toBe('loading');
    expect(readPlanningError(h.state().planning.phase)).toBeNull();
    second.resolve(snapshot(2));
    await expect(fresh).resolves.toBe(true);
    await expect(pan).resolves.toBe(true);
    expect(h.state().planning.phase.kind).toBe('ready');
  });
});
