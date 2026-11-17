import { describe, expect, it, vi } from 'vitest';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { PlanningSnapshot } from './planningCacheTypes';
import { isPlanningHistoryReady } from './planningReadiness';
import { isShownByPlanningState, readPlanningProblem } from './planningNotices';
import { PlanningControllerError } from './planningErrors';
import {
  update,
  inverse,
  receipt,
  deferred,
  ready,
  snapshot,
  readyWithHistory,
} from '@/test/planningTransitionHarness';

// Pins the coordinator transitions that no other controller test asserts directly.

describe('planning write transitions', () => {
  it('publishes the pending outcome before the transport answers', async () => {
    const h = await ready();
    const response = deferred<PlanningMutationSuccess>();
    h.execute.mockImplementationOnce(() => response.promise);
    const write = h.controller.execute(h.controller.begin(), update, inverse);
    const planning = h.state().planning;
    expect(planning.status).toBe('pending');
    expect(planning.pending?.execution).toMatchObject({
      mutationId: 'mutation-1',
      baseRevision: 1,
    });
    expect(planning.outcome).toEqual({ kind: 'pending', execution: planning.pending?.execution });
    expect(isPlanningHistoryReady(planning)).toBe(false);
    h.server.revision = 2;
    response.resolve(receipt('mutation-1', 2));
    await expect(write).resolves.toMatchObject({ revision: 2 });
    expect(h.state().planning).toMatchObject({ status: 'ready', pending: null });
  });

  it("sends an edit's opening row timestamp, and Undo sends none", async () => {
    const h = await ready();
    const openedAt = '2026-01-01T00:00:00.000Z';
    await h.controller.execute(h.controller.begin(), update, inverse, openedAt);
    expect(h.execute.mock.calls[0]?.[1]).toMatchObject({
      intent: update,
      expectedUpdatedAt: openedAt,
    });
    await expect(h.controller.undo()).resolves.toBe(true);
    const undone = h.execute.mock.calls[1]?.[1];
    expect(undone).toMatchObject({ intent: inverse });
    expect(undone).not.toHaveProperty('expectedUpdatedAt');
  });

  it("an acknowledged write shows the server's rows only after the canonical read", async () => {
    const h = await ready();
    const before = h.state().data;
    const canonical = snapshot(2, 'Ferris Aircraft');
    const canonicalRead = deferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => canonicalRead.promise);
    const write = h.controller.execute(h.controller.begin(), update, inverse);
    await vi.waitFor(() => expect(h.state().planning.outcome?.kind).toBe('acknowledged'));
    expect(h.state().data).toBe(before);
    expect(h.state().planning).toMatchObject({ status: 'pending', revision: 1 });
    canonicalRead.resolve(canonical);
    await expect(write).resolves.toMatchObject({ revision: 2 });
    expect(h.state().data).toEqual(canonical.data);
    expect(h.state().planning).toMatchObject({ status: 'ready', revision: 2, pending: null });
  });

  it.each([
    { name: 'a skipped revision', make: () => receipt('mutation-1', 3) },
    { name: 'another mutation id', make: () => receipt('mutation-9', 2) },
  ])('treats a receipt with $name as unconfirmed and shows the server state', async ({ make }) => {
    const h = await ready();
    h.execute.mockResolvedValueOnce(make());
    h.server.revision = 2;
    const reads = h.read.mock.calls.length;
    await expect(h.controller.execute(h.controller.begin(), update, inverse)).rejects.toMatchObject(
      { uncertain: true },
    );
    expect(h.read).toHaveBeenCalledTimes(reads + 1);
    expect(h.state().planning).toMatchObject({
      status: 'ready',
      pending: null,
      revision: 2,
      outcome: { kind: 'unconfirmed', mutationId: 'mutation-1' },
    });
    expect(h.state().data.clients[0]).toMatchObject({
      accountId: 'wayne',
      name: 'Wayne Enterprises',
    });
    expect(h.execute).toHaveBeenCalledOnce();
  });

  it('clears history on a stale refusal after a newer read and resolves it through the refetch', async () => {
    const h = await readyWithHistory();
    const response = deferred<PlanningMutationSuccess>();
    h.execute.mockImplementationOnce(() => response.promise);
    const write = h.controller.execute(h.controller.begin(), update, inverse);
    h.server.revision = 3;
    await h.controller.refresh();
    // A read during an unresolved write keeps history until the write is classified.
    expect(h.state().planning.history.past).toHaveLength(1);
    expect(h.state().planning.status).toBe('pending');
    const stale = new PlanningControllerError('The schedule changed.', 'STALE_REVISION', 409);
    response.reject(stale);
    await expect(write).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(h.state().planning).toMatchObject({
      status: 'ready',
      revision: 3,
      pending: null,
      error: null,
      outcome: { kind: 'refused', mutationId: 'mutation-2', code: 'STALE_REVISION' },
      history: { past: [], future: [] },
    });
    expect(isShownByPlanningState(stale)).toBe(true);
    expect(h.execute).toHaveBeenCalledTimes(2);
  });

  it('keeps rows and history for a validation refusal and allows Undo from the refused state', async () => {
    const h = await readyWithHistory();
    const reads = h.read.mock.calls.length;
    const refusal = new PlanningControllerError('Invalid hours.', 'VALIDATION_ERROR', 400);
    h.execute.mockRejectedValueOnce(refusal);
    await expect(h.controller.execute(h.controller.begin(), update, inverse)).rejects.toMatchObject(
      { code: 'VALIDATION_ERROR', uncertain: false },
    );
    expect(h.state().planning).toMatchObject({
      status: 'refused',
      pending: null,
      error: refusal,
      outcome: { kind: 'refused', mutationId: 'mutation-2', code: 'VALIDATION_ERROR' },
    });
    expect(h.state().planning.history.past).toHaveLength(1);
    expect(h.state().data.clients).toHaveLength(1);
    expect(h.read).toHaveBeenCalledTimes(reads);
    expect(isShownByPlanningState(refusal)).toBe(false);
    expect(readPlanningProblem(h.state().planning)).toBeNull();
    expect(isPlanningHistoryReady(h.state().planning)).toBe(true);
    await expect(h.controller.undo()).resolves.toBe(true);
  });

  it('treats a server failure as unconfirmed with one canonical read and no resend', async () => {
    const h = await ready();
    const reads = h.read.mock.calls.length;
    h.execute.mockRejectedValueOnce(new PlanningControllerError('Unavailable', undefined, 503));
    await expect(h.controller.execute(h.controller.begin(), update, inverse)).rejects.toMatchObject(
      { status: 503, uncertain: true },
    );
    expect(h.read).toHaveBeenCalledTimes(reads + 1);
    expect(h.state().planning).toMatchObject({
      status: 'ready',
      pending: null,
      outcome: { kind: 'unconfirmed', mutationId: 'mutation-1' },
    });
    expect(h.execute).toHaveBeenCalledOnce();
    expect(() => h.controller.begin()).not.toThrow();
  });

  it('reports a 401 write as one authentication loss and clears the projection', async () => {
    const onAuthLoss = vi.fn();
    const h = await readyWithHistory({ onAuthLoss });
    h.execute.mockRejectedValueOnce(new PlanningControllerError('Signed out', undefined, 401));
    await expect(h.controller.execute(h.controller.begin(), update, inverse)).rejects.toMatchObject(
      { status: 401, uncertain: false },
    );
    expect(onAuthLoss).toHaveBeenCalledOnce();
    expect(h.state().planning).toMatchObject({ status: 'idle', context: null, pending: null });
    expect(h.state().planning.history.past).toEqual([]);
    expect(h.state().data).toEqual(emptyAppData());
  });

  it('refuses and refetches a restoration confirmation when no dialog is available', async () => {
    const h = await ready();
    const reads = h.read.mock.calls.length;
    h.execute.mockRejectedValueOnce(
      new PlanningControllerError('Clears 3', 'RESTORATION_CONFIRMATION_REQUIRED', 409, false, 3),
    );
    await expect(h.controller.execute(h.controller.begin(), update, inverse)).rejects.toMatchObject(
      { code: 'RESTORATION_CONFIRMATION_REQUIRED' },
    );
    expect(h.read).toHaveBeenCalledTimes(reads + 1);
    expect(h.state().planning).toMatchObject({
      status: 'ready',
      pending: null,
      outcome: { kind: 'refused', code: 'RESTORATION_CONFIRMATION_REQUIRED' },
    });
    expect(h.execute).toHaveBeenCalledOnce();
  });

  it('finalizes a write but drops history when the post-write read is past its revision', async () => {
    const h = await readyWithHistory();
    h.execute.mockImplementationOnce(async (_context, execution) => {
      h.server.revision = 4;
      return receipt(execution.mutationId, execution.baseRevision + 1);
    });
    await expect(
      h.controller.execute(h.controller.begin(), update, inverse),
    ).resolves.toMatchObject({ revision: 3 });
    expect(h.state().planning).toMatchObject({
      status: 'ready',
      revision: 4,
      pending: null,
      outcome: { kind: 'acknowledged', revision: 3 },
      history: { past: [], future: [], tipRevision: null },
    });
  });
});
