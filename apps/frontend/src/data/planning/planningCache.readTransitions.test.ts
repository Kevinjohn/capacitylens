import { readPlanningError } from './planningNotices';
import { describe, expect, it } from 'vitest';
import { isPlanningHistoryReady } from './planningReadiness';
import { PlanningCacheError } from './planningErrors';
import { readPlanningProblem } from './planningNotices';
import type { PlanningSnapshot } from './planningCacheTypes';
import {
  context,
  ready,
  readyWithHistory,
  setup,
  snapshot,
} from '@/test/planningTransitionHarness';
import { emptyCapacity } from '@/test/capacityFixtures';
import { makePlanningAccess } from '@/test/planning/planningAccessFixtures';
import { createDeferred } from '@/test/createDeferred';

// Pins the coordinator transitions that no other cache test asserts directly.

/** A read without rows, as the harness's server reports it for the revision the page named. */
const unchanged = (revision: number): PlanningSnapshot => ({
  revision,
  authority: makePlanningAccess(),
  slice: 'unchanged',
  today: '2026-06-03',
  capacity: emptyCapacity(),
});

/** What the server reports to this page after its one change. */
const undoable = { canUndo: true, canRedo: false };

describe('planning read transitions', () => {
  it('publishes loading during a background read and refuses a new change until it settles', async () => {
    const h = await readyWithHistory();
    const read = createDeferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => read.promise);
    const refreshing = h.cache.refresh();
    expect(h.state().planning.phase.kind).toBe('loading');
    expect(isPlanningHistoryReady(h.state().planning, 'undo')).toBe(false);
    expect(() => h.cache.begin()).toThrow(/not ready/);
    await expect(h.cache.undo()).resolves.toBe(false);
    read.resolve(snapshot(2, undefined, undoable));
    await refreshing;
    expect(h.state().planning.phase.kind).toBe('ready');
    expect(isPlanningHistoryReady(h.state().planning, 'undo')).toBe(true);
    expect(h.execute).toHaveBeenCalledOnce();
  });

  it('keeps a settled status through a quiet read, so a change can start meanwhile', async () => {
    const h = await readyWithHistory();
    const read = createDeferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => read.promise);
    const refreshing = h.cache.refresh({ quiet: true });
    expect(h.state().planning.phase.kind).toBe('ready');
    expect(isPlanningHistoryReady(h.state().planning, 'undo')).toBe(true);
    expect(() => h.cache.begin()).not.toThrow();
    read.resolve(snapshot(2, undefined, undoable));
    await expect(refreshing).resolves.toBe(true);
    expect(h.state().planning.phase.kind).toBe('ready');
  });

  it('surfaces a failed quiet read, and shows the next quiet read from that error as loading', async () => {
    const h = await readyWithHistory();
    h.read.mockRejectedValueOnce(new TypeError('read unavailable'));
    await expect(h.cache.refresh({ quiet: true })).resolves.toBe(false);
    expect(h.state().planning.phase.kind).toBe('failed');
    expect(readPlanningProblem(h.state().planning)).toBe('unavailable');

    const read = createDeferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => read.promise);
    const refreshing = h.cache.refresh({ quiet: true });
    expect(h.state().planning.phase.kind).toBe('loading');
    expect(readPlanningError(h.state().planning.phase)).toBeNull();
    read.resolve(snapshot(2, undefined, undoable));
    await expect(refreshing).resolves.toBe(true);
    expect(h.state().planning.phase.kind).toBe('ready');
  });

  it('surfaces a failed read as unavailable, keeps rows and history, and blocks writes until a read succeeds', async () => {
    const h = await readyWithHistory();
    h.read.mockRejectedValueOnce(new TypeError('read unavailable'));
    await expect(h.cache.refresh()).resolves.toBe(false);
    expect(h.state().planning.phase.kind).toBe('failed');
    expect(readPlanningProblem(h.state().planning)).toBe('unavailable');
    expect(h.state().data.clients[0]?.name).toBe('Wayne Enterprises');
    expect(h.state().planning.history.canUndo).toBe(true);
    expect(() => h.cache.begin()).toThrow(/not ready/);
    await expect(h.cache.undo()).resolves.toBe(false);

    await expect(h.cache.refresh()).resolves.toBe(true);
    expect(h.state().planning.phase.kind).toBe('ready');
    expect(readPlanningProblem(h.state().planning)).toBeNull();
    await expect(h.cache.undo()).resolves.toBe(true);
  });

  it('takes the company date from each same-revision read and keeps history', async () => {
    const h = await readyWithHistory();
    h.read.mockResolvedValueOnce({ ...snapshot(2, undefined, undoable), today: '2026-06-01' });
    await expect(h.cache.refresh()).resolves.toBe(true);
    expect(h.state().planning.today).toBe('2026-06-01');

    h.read.mockResolvedValueOnce({ ...snapshot(2, undefined, undoable), today: '2026-06-02' });
    await expect(h.cache.refresh()).resolves.toBe(true);
    expect(h.state().planning.today).toBe('2026-06-02');
    expect(h.state().planning.history.canUndo).toBe(true);
  });

  it('rejects an older snapshot under the same authority without replacing rows', async () => {
    const h = await ready();
    h.server.revision = 5;
    await h.cache.refresh();
    h.read.mockResolvedValueOnce(snapshot(4, 'Older Wayne name'));
    await expect(h.cache.refresh()).resolves.toBe(false);
    expect(h.state().planning.phase.kind).toBe('failed');
    expect(h.state().planning.revision).toBe(5);
    expect(readPlanningError(h.state().planning.phase)).toBeInstanceOf(PlanningCacheError);
    expect(h.state().data.clients[0]?.name).toBe('Wayne Enterprises');
  });

  it("resolves a read that a newer read supersedes with the newer read's outcome", async () => {
    const h = await ready();
    const first = createDeferred<PlanningSnapshot>();
    const second = createDeferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => first.promise);
    h.read.mockImplementationOnce(() => second.promise);
    const fresh = h.cache.refresh();
    const pan = h.cache.refresh({ quiet: true });
    first.resolve(snapshot(2, 'Stale Wayne name'));
    second.resolve(snapshot(2));
    await expect(fresh).resolves.toBe(true);
    await expect(pan).resolves.toBe(true);
    expect(h.state().data.clients[0]?.name).toBe('Wayne Enterprises');
  });

  it('aborts a read that a newer read supersedes, without showing an error', async () => {
    const h = await ready();
    const second = createDeferred<PlanningSnapshot>();
    let firstSignal: AbortSignal | undefined;
    h.read.mockImplementationOnce(
      (_context, signal) =>
        new Promise((_resolve, reject) => {
          firstSignal = signal;
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    h.read.mockImplementationOnce(() => second.promise);
    const fresh = h.cache.refresh();
    const pan = h.cache.refresh({ quiet: true });
    expect(firstSignal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.state().planning.phase.kind).toBe('loading');
    expect(readPlanningError(h.state().planning.phase)).toBeNull();
    second.resolve(snapshot(2));
    await expect(fresh).resolves.toBe(true);
    await expect(pan).resolves.toBe(true);
    expect(h.state().planning.phase.kind).toBe('ready');
  });

  it('keeps the cached rows on an unchanged read and takes its capacity', async () => {
    const h = await ready();
    const rows = h.state().data;
    const capacity = emptyCapacity({ from: '2026-06-04', to: '2026-06-04' });
    h.read.mockResolvedValueOnce({ ...unchanged(1), capacity, today: '2026-06-04' });
    await expect(h.cache.refresh({ quiet: true })).resolves.toBe(true);
    expect(h.read.mock.lastCall?.[2]?.ifRevision).toBe(1);
    expect(h.state().data).toBe(rows);
    expect(h.state().data.clients[0]).toBe(rows.clients[0]);
    expect(h.state().planning.capacity).toBe(capacity);
    expect(h.state().planning.today).toBe('2026-06-04');
  });

  it('reads the full slice once when an unchanged read names another revision', async () => {
    const h = await ready();
    h.read.mockResolvedValueOnce(unchanged(2));
    await expect(h.cache.refresh()).resolves.toBe(true);
    expect(h.read).toHaveBeenCalledTimes(3);
    expect(h.read.mock.calls[1]?.[2]?.ifRevision).toBe(1);
    expect(h.read.mock.calls[2]?.[2]).not.toHaveProperty('ifRevision');
    expect(h.state().planning.revision).toBe(1);
  });

  it('names no revision from a new context', async () => {
    const h = setup();
    h.cache.setContext(context);
    await expect(h.cache.refresh()).resolves.toBe(true);
    expect(h.read.mock.calls[0]?.[2]).not.toHaveProperty('ifRevision');
    h.cache.setContext({ ...context, identity: 'another-session' });
    await expect(h.cache.refresh()).resolves.toBe(true);
    expect(h.read.mock.calls[1]?.[2]).not.toHaveProperty('ifRevision');
  });
});
