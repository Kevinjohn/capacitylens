import { describe, expect, it } from 'vitest';
import {
  isPlanningHistoryReady,
  PlanningControllerError,
  readPlanningProblem,
} from './planningCacheController';
import type { PlanningSnapshot } from './planningCacheController';
import { snapshot, deferred, ready, readyWithHistory } from '@/test/planningTransitionHarness';

// Pins the coordinator transitions that no other controller test asserts directly.

describe('planning read transitions', () => {
  it('publishes loading during a background read and refuses a new change until it settles', async () => {
    const h = await readyWithHistory();
    const read = deferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => read.promise);
    const refreshing = h.controller.refresh();
    expect(h.state().planning.status).toBe('loading');
    expect(isPlanningHistoryReady(h.state().planning)).toBe(false);
    expect(() => h.controller.begin({})).toThrow(/not ready/);
    await expect(h.controller.undo()).resolves.toBe(false);
    read.resolve(snapshot(2));
    await refreshing;
    expect(h.state().planning.status).toBe('ready');
    expect(isPlanningHistoryReady(h.state().planning)).toBe(true);
    expect(h.execute).toHaveBeenCalledOnce();
  });

  it('surfaces a failed read as unavailable, keeps rows and history, and blocks writes until a read succeeds', async () => {
    const h = await readyWithHistory();
    h.read.mockRejectedValueOnce(new TypeError('read unavailable'));
    await expect(h.controller.refresh()).resolves.toBe(false);
    expect(h.state().planning.status).toBe('error');
    expect(readPlanningProblem(h.state().planning)).toBe('unavailable');
    expect(h.state().data.clients[0]?.name).toBe('Wayne Enterprises');
    expect(h.state().planning.history.past).toHaveLength(1);
    expect(() => h.controller.begin({})).toThrow(/not ready/);
    await expect(h.controller.undo()).resolves.toBe(false);

    await expect(h.controller.refresh()).resolves.toBe(true);
    expect(h.state().planning.status).toBe('ready');
    expect(readPlanningProblem(h.state().planning)).toBeNull();
    await expect(h.controller.undo()).resolves.toBe(true);
  });

  it('rejects an older snapshot under the same authority without replacing rows', async () => {
    const h = await ready();
    h.server.revision = 5;
    await h.controller.refresh();
    h.read.mockResolvedValueOnce(snapshot(4, 'Older Wayne name'));
    await expect(h.controller.refresh()).resolves.toBe(false);
    expect(h.state().planning.status).toBe('error');
    expect(h.state().planning.revision).toBe(5);
    expect(h.state().planning.error).toBeInstanceOf(PlanningControllerError);
    expect(h.state().data.clients[0]?.name).toBe('Wayne Enterprises');
  });
});
