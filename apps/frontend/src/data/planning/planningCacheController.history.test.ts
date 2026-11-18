import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanningTransport } from './planningCacheTypes';
import { setMasqueradeContextToken } from '@/api/masqueradeContext';
import {
  context,
  intent,
  canonicalData,
  companyToday,
  success,
  harness,
} from './planningCacheController.testSupport';
import { emptyCapacity } from '@/test/capacityFixtures';

afterEach(() => setMasqueradeContextToken(null));

const committing = () =>
  vi.fn<PlanningTransport['execute']>((_context, execution) =>
    Promise.resolve(success(execution.mutationId, execution.baseRevision + 1)),
  );

async function loaded(transport: Parameters<typeof harness>[0], revision = 1) {
  const h = harness(transport);
  h.controller.setContext(context);
  await h.readSnapshot({
    revision,
    canWrite: true,
    data: canonicalData(),
    today: companyToday,
    capacity: emptyCapacity(),
  });
  return h;
}

describe('planning cache controller history', () => {
  it('names one history id on every read and write, and shows what the server reports', async () => {
    const execute = committing();
    const h = await loaded({ execute, read: vi.fn<PlanningTransport['read']>() });
    expect(h.state().planning.history).toEqual({ canUndo: false, canRedo: false });
    await h.controller.execute(h.controller.begin(), intent);
    expect(h.state().planning.history).toEqual({ canUndo: true, canRedo: false });
    const historyId = execute.mock.calls[0]?.[1].historyId;
    expect(historyId).toEqual(expect.any(String));
    expect(h.read.mock.calls.map((call) => call[2]?.historyId)).toEqual([historyId, historyId]);
  });

  it('names no history on a change that ends it, so the server offers no undo', async () => {
    const execute = committing();
    const h = await loaded({ execute, read: vi.fn<PlanningTransport['read']>() });
    await h.controller.execute(h.controller.begin(), intent);
    expect(h.state().planning.history.canUndo).toBe(true);
    await h.controller.execute(h.controller.begin(), intent, undefined, true);
    expect(execute.mock.calls[1]?.[1]).not.toHaveProperty('historyId');
    expect(h.state().planning.history).toEqual({ canUndo: false, canRedo: false });
  });

  it('keeps history for a same-revision read and loses it when another change moves on', async () => {
    const h = await loaded({ execute: committing(), read: vi.fn<PlanningTransport['read']>() });
    await h.controller.execute(h.controller.begin(), intent);
    const same = { canWrite: true, data: canonicalData(), today: companyToday };
    await h.readSnapshot({ ...same, revision: 2, capacity: emptyCapacity() });
    expect(h.state().planning.history.canUndo).toBe(true);
    await h.readSnapshot({ ...same, revision: 3, capacity: emptyCapacity() });
    expect(h.state().planning.history.canUndo).toBe(false);
  });

  it('sends Undo and Redo as fresh steps of the same history at the current revision', async () => {
    const undo = vi.fn<PlanningTransport['undo']>(async (_context, step) =>
      success(step.mutationId, step.baseRevision + 1),
    );
    const redo = vi.fn<PlanningTransport['redo']>(async (_context, step) =>
      success(step.mutationId, step.baseRevision + 1),
    );
    const execute = committing();
    const read = vi
      .fn<PlanningTransport['read']>()
      .mockResolvedValueOnce({
        revision: 2,
        canWrite: true,
        data: canonicalData(),
        today: companyToday,
        capacity: emptyCapacity(),
        history: { canUndo: true, canRedo: false },
      })
      .mockResolvedValueOnce({
        revision: 3,
        canWrite: true,
        data: canonicalData(),
        today: companyToday,
        capacity: emptyCapacity(),
        history: { canUndo: false, canRedo: true },
      })
      .mockResolvedValueOnce({
        revision: 4,
        canWrite: true,
        data: canonicalData(),
        today: companyToday,
        capacity: emptyCapacity(),
        history: { canUndo: true, canRedo: false },
      });
    const h = await loaded({ execute, read, undo, redo });
    await h.controller.execute(h.controller.begin(), intent);
    await expect(h.controller.undo()).resolves.toBe(true);
    expect(h.state().planning.history).toEqual({ canUndo: false, canRedo: true });
    await expect(h.controller.redo()).resolves.toBe(true);
    expect(h.state().planning.history).toEqual({ canUndo: true, canRedo: false });
    const historyId = execute.mock.calls[0]?.[1].historyId;
    const steps = [undo.mock.calls[0]?.[1], redo.mock.calls[0]?.[1]];
    expect(steps).toEqual([
      { mutationId: 'mutation-2', baseRevision: 2, historyId },
      { mutationId: 'mutation-3', baseRevision: 3, historyId },
    ]);
    expect(h.state().planning.revision).toBe(4);
  });

  it('does not ask the server when it reported nothing to undo or redo', async () => {
    const undo = vi.fn<PlanningTransport['undo']>();
    const redo = vi.fn<PlanningTransport['redo']>();
    const h = await loaded({ execute: committing(), read: vi.fn(), undo, redo });
    await expect(h.controller.undo()).resolves.toBe(false);
    await expect(h.controller.redo()).resolves.toBe(false);
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it('keeps a refusal distinct and the reported history unchanged', async () => {
    const h = await loaded({
      execute: vi
        .fn<PlanningTransport['execute']>()
        .mockRejectedValue({ status: 400, code: 'NO_CHANGE' }),
      read: vi.fn<PlanningTransport['read']>(),
    });
    await expect(h.controller.execute(h.controller.begin(), intent)).rejects.toMatchObject({
      code: 'NO_CHANGE',
    });
    expect(h.state().planning.outcome).toMatchObject({ kind: 'refused', code: 'NO_CHANGE' });
    expect(h.state().planning.history).toEqual({ canUndo: false, canRedo: false });
  });

  it.each([
    { status: 400, code: 'VALIDATION_ERROR' },
    { status: 403, code: 'AUTHORIZATION_DENIED' },
    { status: 409 },
  ])('rereads after a refused Undo so the ended history shows ($status)', async (refusal) => {
    const undo = vi.fn<PlanningTransport['undo']>().mockRejectedValue(refusal);
    const h = await loaded({ execute: committing(), read: vi.fn(), undo });
    await h.controller.execute(h.controller.begin(), intent);
    const reads = h.read.mock.calls.length;
    // The server ends the history after refusing one of its steps; its next read says so.
    h.read.mockResolvedValueOnce({
      revision: 2,
      canWrite: true,
      data: canonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
      history: { canUndo: false, canRedo: false },
    });
    await expect(h.controller.undo()).rejects.toMatchObject({ status: refusal.status });
    expect(h.read.mock.calls.length).toBe(reads + 1);
    expect(h.state().planning).toMatchObject({
      status: 'ready',
      pending: null,
      history: { canUndo: false, canRedo: false },
    });
  });

  it('loses history when the company changes, even after switching back', async () => {
    const h = await loaded({ execute: committing(), read: vi.fn() });
    await h.controller.execute(h.controller.begin(), intent);
    const first = h.read.mock.calls.at(-1)?.[2]?.historyId;
    h.controller.setContext({ ...context, companyId: 'company-2' });
    expect(h.state().planning.history).toEqual({ canUndo: false, canRedo: false });
    h.controller.setContext(context);
    await h.controller.refresh();
    expect(h.read.mock.calls.at(-1)?.[2]?.historyId).not.toBe(first);
    expect(h.state().planning.history).toEqual({ canUndo: false, canRedo: false });
  });
});
