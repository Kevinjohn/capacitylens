import { describe, expect, it, vi } from 'vitest';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import { makeClient } from '@/test/fixtures';
import {
  isPlanningHistoryReady,
  isShownByPlanningState,
  PlanningControllerError,
  readPlanningProblem,
} from './planningCacheController';
import {
  update,
  inverse,
  receipt,
  deferred,
  ready,
  readyWithHistory,
} from '@/test/planningTransitionHarness';

// Pins the coordinator transitions that no other controller test asserts directly.

describe('planning write transitions', () => {
  it('publishes the pending outcome before the transport answers', async () => {
    const h = await ready();
    const response = deferred<PlanningMutationSuccess>();
    h.execute.mockImplementationOnce(() => response.promise);
    const write = h.controller.execute(h.controller.begin({}), update, inverse);
    const planning = h.state().planning;
    expect(planning.status).toBe('pending');
    expect(planning.pending?.execution).toMatchObject({
      mutationId: 'mutation-1',
      baseRevision: 1,
    });
    expect(planning.outcome).toEqual({ kind: 'pending', execution: planning.pending?.execution });
    expect(isPlanningHistoryReady(planning)).toBe(false);
    await expect(h.controller.reconcile()).resolves.toBe(false);
    expect(h.lookup).not.toHaveBeenCalled();
    h.server.revision = 2;
    response.resolve(receipt('mutation-1', 2));
    await expect(write).resolves.toMatchObject({ revision: 2 });
    expect(h.state().planning).toMatchObject({ status: 'ready', pending: null });
  });

  it.each([
    { name: 'a skipped revision', make: () => receipt('mutation-1', 3) },
    { name: 'another mutation id', make: () => receipt('mutation-9', 2) },
    {
      name: 'a foreign-company projection',
      make: () =>
        receipt('mutation-1', 2, {
          projection: {
            mode: 'patch',
            history: 'retain',
            changed: {
              upserts: [
                {
                  entity: 'clients',
                  row: makeClient({ id: 'client-1', accountId: 'lexcorp', name: 'LexCorp' }),
                },
              ],
              removed: [],
            },
          },
        }),
    },
  ])('treats a receipt with $name as uncertain and recovers it by lookup', async ({ make }) => {
    const h = await ready();
    h.execute.mockResolvedValueOnce(make());
    const reads = h.read.mock.calls.length;
    await expect(
      h.controller.execute(h.controller.begin({}), update, inverse),
    ).rejects.toMatchObject({ uncertain: true });
    expect(h.state().planning.status).toBe('uncertain');
    expect(h.state().planning.outcome?.kind).toBe('uncertain');
    expect(h.state().planning.pending?.execution.mutationId).toBe('mutation-1');
    expect(h.state().data.clients[0]).toMatchObject({
      accountId: 'wayne',
      name: 'Wayne Enterprises',
    });
    expect(h.read).toHaveBeenCalledTimes(reads);

    h.lookup.mockResolvedValueOnce({ status: 'committed', mutationId: 'mutation-1', revision: 2 });
    h.server.revision = 2;
    await expect(h.controller.reconcile()).resolves.toBe(true);
    expect(h.state().planning).toMatchObject({ status: 'ready', pending: null, revision: 2 });
    expect(h.execute).toHaveBeenCalledOnce();
  });

  it('clears history on a stale refusal after a newer read and resolves it through the refetch', async () => {
    const h = await readyWithHistory();
    const response = deferred<PlanningMutationSuccess>();
    h.execute.mockImplementationOnce(() => response.promise);
    const write = h.controller.execute(h.controller.begin({}), update, inverse);
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
    await expect(
      h.controller.execute(h.controller.begin({}), update, inverse),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', uncertain: false });
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

  it('treats a server failure as uncertain without a canonical read or a release', async () => {
    const h = await ready();
    const reads = h.read.mock.calls.length;
    h.execute.mockRejectedValueOnce(new PlanningControllerError('Unavailable', undefined, 503));
    await expect(
      h.controller.execute(h.controller.begin({}), update, inverse),
    ).rejects.toMatchObject({ status: 503, uncertain: true });
    expect(h.state().planning.status).toBe('uncertain');
    expect(h.state().planning.pending?.execution.mutationId).toBe('mutation-1');
    expect(h.read).toHaveBeenCalledTimes(reads);
    expect(() => h.controller.begin({})).toThrow();
  });

  it('reports a 401 write as one authentication loss and clears the projection', async () => {
    const onAuthLoss = vi.fn();
    const h = await readyWithHistory({ onAuthLoss });
    h.execute.mockRejectedValueOnce(new PlanningControllerError('Signed out', undefined, 401));
    await expect(
      h.controller.execute(h.controller.begin({}), update, inverse),
    ).rejects.toMatchObject({ status: 401, uncertain: false });
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
    await expect(
      h.controller.execute(h.controller.begin({}), update, inverse),
    ).rejects.toMatchObject({ code: 'RESTORATION_CONFIRMATION_REQUIRED' });
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
      h.controller.execute(h.controller.begin({}), update, inverse),
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
