import { describe, expect, it, vi } from 'vitest';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import { createEmptyAppData } from '@capacitylens/shared/types/entities';
import type { PlanningSnapshot } from './planningCacheTypes';
import { isPlanningHistoryReady } from './planningReadiness';
import { isShownByPlanningState, readPlanningProblem } from './planningNotices';
import { PlanningCacheError } from './planningErrors';
import {
  update,
  makeReceipt,
  ready,
  snapshot,
  readyWithHistory,
} from '@/test/planningTransitionHarness';
import { emptyCapacity } from '@/test/capacityFixtures';
import { makePlanningAccess } from '@/test/planning/planningAccessFixtures';
import { createDeferred } from '@/test/createDeferred';

/** A read without rows, as the harness's server reports it for the revision the page named. */
const unchanged = (revision: number): PlanningSnapshot => ({
  revision,
  authority: makePlanningAccess(),
  slice: 'unchanged',
  today: '2026-06-03',
  capacity: emptyCapacity(),
});

// Pins the coordinator transitions that no other cache test asserts directly.

describe('planning write transitions', () => {
  it('publishes the pending outcome before the transport answers', async () => {
    const h = await ready();
    const response = createDeferred<PlanningMutationSuccess>();
    h.execute.mockImplementationOnce(() => response.promise);
    const write = h.cache.execute(h.cache.begin(), update);
    const planning = h.state().planning;
    expect(planning.phase.kind).toBe('writing');
    expect(planning.phase).toMatchObject({
      write: { execution: { mutationId: 'mutation-1', baseRevision: 1 } },
      readError: null,
    });
    expect(isPlanningHistoryReady(planning, 'undo')).toBe(false);
    h.server.revision = 2;
    response.resolve(makeReceipt('mutation-1', 2));
    await expect(write).resolves.toMatchObject({ revision: 2 });
    expect(h.state().planning.phase).toMatchObject({ kind: 'ready' });
  });

  it("sends an edit's opening row timestamp, and Undo sends only its history step", async () => {
    const h = await ready();
    const openedAt = '2026-01-01T00:00:00.000Z';
    await h.cache.execute(h.cache.begin(), update, openedAt);
    expect(h.execute.mock.calls[0]?.[1]).toEqual({
      mutationId: 'mutation-1',
      baseRevision: 1,
      historyId: 'history-2',
      intent: update,
      expectedUpdatedAt: openedAt,
    });
    await expect(h.cache.undo()).resolves.toBe(true);
    expect(h.undo.mock.calls[0]?.[1]).toEqual({
      mutationId: 'mutation-2',
      baseRevision: 2,
      historyId: 'history-2',
    });
  });

  it("an acknowledged write without receipt rows shows the server's rows only after the canonical read", async () => {
    const h = await ready();
    const before = h.state().data;
    const canonical = snapshot(2, 'Ferris Aircraft');
    const canonicalRead = createDeferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => canonicalRead.promise);
    const write = h.cache.execute(h.cache.begin(), update);
    await vi.waitFor(() =>
      expect(h.state().planning.phase).toMatchObject({ write: { commitment: { revision: 2 } } }),
    );
    expect(h.state().data).toBe(before);
    expect(h.state().planning).toMatchObject({ phase: { kind: 'writing' }, revision: 2 });
    canonicalRead.resolve(canonical);
    await expect(write).resolves.toMatchObject({ revision: 2 });
    expect(h.state().data).toEqual(canonical.data);
    expect(h.state().planning).toMatchObject({ phase: { kind: 'ready' }, revision: 2 });
  });

  it.each([
    { name: 'a skipped revision', make: () => makeReceipt('mutation-1', 3) },
    { name: 'another mutation id', make: () => makeReceipt('mutation-9', 2) },
  ])('treats a receipt with $name as unconfirmed and shows the server state', async ({ make }) => {
    const h = await ready();
    h.execute.mockResolvedValueOnce(make());
    h.server.revision = 2;
    const reads = h.read.mock.calls.length;
    await expect(h.cache.execute(h.cache.begin(), update)).rejects.toMatchObject({
      uncertain: true,
    });
    expect(h.read).toHaveBeenCalledTimes(reads + 1);
    expect(h.state().planning).toMatchObject({
      phase: { kind: 'ready', lastWrite: { kind: 'unconfirmed', mutationId: 'mutation-1' } },
      revision: 2,
    });
    expect(h.state().data.clients[0]).toMatchObject({
      companyId: 'wayne',
      name: 'Wayne Enterprises',
    });
    expect(h.execute).toHaveBeenCalledOnce();
  });

  it('shows history ended by another change and resolves a stale refusal through the refetch', async () => {
    const h = await readyWithHistory();
    const response = createDeferred<PlanningMutationSuccess>();
    h.execute.mockImplementationOnce(() => response.promise);
    const write = h.cache.execute(h.cache.begin(), update);
    h.server.revision = 3;
    await h.cache.refresh();
    // Another change moved the revision on, so the server reports this page's history as ended,
    // even while the write is unresolved.
    expect(h.state().planning.history.canUndo).toBe(false);
    expect(h.state().planning.phase.kind).toBe('writing');
    const stale = new PlanningCacheError('The schedule changed.', 'STALE_REVISION', 409);
    response.reject(stale);
    await expect(write).rejects.toMatchObject({ code: 'STALE_REVISION' });
    // The refetch that resolves the refusal ends it.
    expect(h.state().planning).toMatchObject({
      phase: { kind: 'ready', lastWrite: null },
      revision: 3,
      history: { canUndo: false, canRedo: false },
    });
    expect(isShownByPlanningState(stale)).toBe(true);
    expect(h.execute).toHaveBeenCalledTimes(2);
  });

  it('keeps history when a row-timestamp refusal leaves the revision where it was', async () => {
    const h = await readyWithHistory();
    const stale = new PlanningCacheError('The record changed.', 'STALE_REVISION', 409);
    h.execute.mockRejectedValueOnce(stale);
    await expect(
      h.cache.execute(h.cache.begin(), update, '2026-01-01T00:00:00.000Z'),
    ).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(h.state().planning).toMatchObject({
      revision: 2,
      phase: { kind: 'ready', lastWrite: null },
    });
    expect(h.state().planning.history.canUndo).toBe(true);
    expect(isPlanningHistoryReady(h.state().planning, 'undo')).toBe(true);
  });

  it('keeps rows and history for a validation refusal and allows Undo from the refused state', async () => {
    const h = await readyWithHistory();
    const reads = h.read.mock.calls.length;
    const refusal = new PlanningCacheError('Invalid hours.', 'VALIDATION_ERROR', 400);
    h.execute.mockRejectedValueOnce(refusal);
    await expect(h.cache.execute(h.cache.begin(), update)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      uncertain: false,
    });
    expect(h.state().planning.phase).toEqual({
      kind: 'ready',
      lastWrite: {
        kind: 'refused',
        mutationId: 'mutation-2',
        code: 'VALIDATION_ERROR',
        error: refusal,
      },
    });
    expect(h.state().planning.history.canUndo).toBe(true);
    expect(h.state().data.clients).toHaveLength(1);
    expect(h.read).toHaveBeenCalledTimes(reads);
    expect(isShownByPlanningState(refusal)).toBe(false);
    expect(readPlanningProblem(h.state().planning)).toBeNull();
    expect(isPlanningHistoryReady(h.state().planning, 'undo')).toBe(true);
    await expect(h.cache.undo()).resolves.toBe(true);
  });

  it('treats a server failure as unconfirmed with one canonical read and no resend', async () => {
    const h = await ready();
    const reads = h.read.mock.calls.length;
    h.execute.mockRejectedValueOnce(new PlanningCacheError('Unavailable', undefined, 503));
    await expect(h.cache.execute(h.cache.begin(), update)).rejects.toMatchObject({
      status: 503,
      uncertain: true,
    });
    expect(h.read).toHaveBeenCalledTimes(reads + 1);
    expect(h.state().planning.phase).toEqual({
      kind: 'ready',
      lastWrite: { kind: 'unconfirmed', mutationId: 'mutation-1' },
    });
    expect(h.execute).toHaveBeenCalledOnce();
    expect(() => h.cache.begin()).not.toThrow();
  });

  it('reports a 401 write as one authentication loss and clears the projection', async () => {
    const onAuthLoss = vi.fn();
    const h = await readyWithHistory({ onAuthLoss });
    h.execute.mockRejectedValueOnce(new PlanningCacheError('Signed out', undefined, 401));
    await expect(h.cache.execute(h.cache.begin(), update)).rejects.toMatchObject({
      status: 401,
      uncertain: false,
    });
    expect(onAuthLoss).toHaveBeenCalledOnce();
    expect(h.state().planning).toMatchObject({ phase: { kind: 'idle' }, context: null });
    expect(h.state().planning.history).toEqual({ canUndo: false, canRedo: false });
    expect(h.state().data).toEqual(createEmptyAppData());
  });

  it('refuses and refetches a restoration confirmation when no dialog is available', async () => {
    const h = await ready();
    const reads = h.read.mock.calls.length;
    h.execute.mockRejectedValueOnce(
      new PlanningCacheError('Clears 3', 'RESTORATION_CONFIRMATION_REQUIRED', 409, false, 3),
    );
    await expect(h.cache.execute(h.cache.begin(), update)).rejects.toMatchObject({
      code: 'RESTORATION_CONFIRMATION_REQUIRED',
    });
    expect(h.read).toHaveBeenCalledTimes(reads + 1);
    expect(h.state().planning.phase).toEqual({ kind: 'ready', lastWrite: null });
    expect(h.execute).toHaveBeenCalledOnce();
  });

  it('finalizes a write but drops history when the post-write read is past its revision', async () => {
    const h = await readyWithHistory();
    h.execute.mockImplementationOnce(async (_context, execution) => {
      h.server.revision = 4;
      return makeReceipt(execution.mutationId, execution.baseRevision + 1);
    });
    await expect(h.cache.execute(h.cache.begin(), update)).resolves.toMatchObject({
      revision: 3,
    });
    expect(h.state().planning).toMatchObject({
      phase: { kind: 'ready', lastWrite: { kind: 'acknowledged', revision: 3 } },
      revision: 4,
      history: { canUndo: false, canRedo: false },
    });
  });

  it("applies a receipt's rows on top of the revision it was written against", async () => {
    const h = await ready();
    const client = h.state().data.clients[0];
    if (!client) throw new Error('Expected a cached client.');
    const renamed = { ...client, name: 'Ferris Aircraft' };
    h.execute.mockImplementationOnce(async (_context, execution) => {
      h.server.revision = 2;
      return makeReceipt(execution.mutationId, 2, {
        changes: { upserts: [{ entity: 'clients', row: renamed }], removed: [] },
      });
    });
    h.read.mockImplementationOnce(async (_context, _signal, request) => {
      if (request?.ifRevision !== 2) throw new Error('Expected the read to name revision 2.');
      return unchanged(2);
    });
    await expect(h.cache.execute(h.cache.begin(), update)).resolves.toMatchObject({
      revision: 2,
    });
    expect(h.state().data.clients).toEqual([renamed]);
    expect(h.state().planning).toMatchObject({ phase: { kind: 'ready' }, revision: 2 });
  });

  it('does not apply a receipt when the cache has moved past its base revision', async () => {
    const h = await ready();
    const response = createDeferred<PlanningMutationSuccess>();
    h.execute.mockImplementationOnce(() => response.promise);
    const write = h.cache.execute(h.cache.begin(), update);
    h.read.mockResolvedValueOnce(snapshot(3, 'Kord Industries'));
    await h.cache.refresh({ quiet: true });
    expect(h.state().planning.revision).toBe(3);

    h.server.revision = 3;
    h.read.mockImplementationOnce(async (_context, _signal, request) =>
      request?.ifRevision === 3 ? unchanged(3) : snapshot(3),
    );
    const client = h.state().data.clients[0];
    if (!client) throw new Error('Expected a cached client.');
    response.resolve(
      makeReceipt('mutation-1', 2, {
        changes: {
          upserts: [{ entity: 'clients', row: { ...client, name: 'Stale' } }],
          removed: [],
        },
      }),
    );
    await write;
    expect(h.read.mock.lastCall?.[2]?.ifRevision).toBe(3);
    expect(h.state().data.clients[0]?.name).toBe('Kord Industries');
  });
});
