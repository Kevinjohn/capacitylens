import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanningIntent } from '@/api/planningContracts';
import type { PlanningTransport } from './planningCacheTypes';
import { setMasqueradeContextToken } from '@/auth/masqueradeContext';
import {
  context,
  intent,
  inverse,
  canonicalData,
  success,
  harness,
  deferred,
  uncertainHarness,
} from './planningCacheController.testSupport';

afterEach(() => setMasqueradeContextToken(null));

describe('planning cache controller', () => {
  it('retains the existing fifty-action page-local history limit', async () => {
    const execute = vi.fn<PlanningTransport['execute']>((_context, execution) =>
      Promise.resolve(success(execution.mutationId, execution.baseRevision + 1)),
    );
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport['read']>(),
      lookup: vi.fn<PlanningTransport['lookup']>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 0, canWrite: true, data: canonicalData() });
    for (let index = 0; index < 51; index += 1) {
      await h.controller.execute(h.controller.begin(), intent, inverse);
    }
    expect(h.state().planning.history.past).toHaveLength(50);
    for (let index = 0; index < 50; index += 1) {
      await expect(h.controller.undo()).resolves.toBe(true);
    }
    await expect(h.controller.undo()).resolves.toBe(false);
    expect(h.state().planning.history.future).toHaveLength(50);
    await expect(h.controller.redo()).resolves.toBe(true);
    expect(h.state().planning.history.past).toHaveLength(1);
  });

  it('retains history for same-revision reads and clears it for external revisions', async () => {
    const execute = vi.fn<PlanningTransport['execute']>((_context, execution) =>
      Promise.resolve(success(execution.mutationId, execution.baseRevision + 1)),
    );
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport['read']>(),
      lookup: vi.fn<PlanningTransport['lookup']>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: canonicalData() });
    const draft = h.controller.begin();
    await h.controller.execute(draft, intent, inverse);
    expect(h.state().planning.history.past).toHaveLength(1);
    await h.readSnapshot({ revision: 2, canWrite: true, data: canonicalData() });
    expect(h.state().planning.history.past).toHaveLength(1);
    await h.readSnapshot({ revision: 3, canWrite: true, data: canonicalData() });
    expect(h.state().planning.history.past).toHaveLength(0);
  });

  it('gives Undo and Redo fresh mutation ids and the current acknowledged revision', async () => {
    const executions: Array<{ mutationId: string; baseRevision: number }> = [];
    const execute = vi.fn<PlanningTransport['execute']>((_context, execution) => {
      executions.push({ mutationId: execution.mutationId, baseRevision: execution.baseRevision });
      return Promise.resolve(success(execution.mutationId, execution.baseRevision + 1));
    });
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport['read']>(),
      lookup: vi.fn<PlanningTransport['lookup']>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: canonicalData() });
    await h.controller.execute(h.controller.begin(), intent, inverse);
    expect(await h.controller.undo()).toBe(true);
    expect(await h.controller.redo()).toBe(true);
    expect(executions.map(({ baseRevision }) => baseRevision)).toEqual([1, 2, 3]);
    expect(new Set(executions.map(({ mutationId }) => mutationId)).size).toBe(3);
    expect(h.state().planning.history.tipRevision).toBe(4);
  });

  it('does not add history for no_change and keeps the refusal distinct', async () => {
    const h = harness({
      execute: vi
        .fn<PlanningTransport['execute']>()
        .mockRejectedValue({ status: 400, code: 'NO_CHANGE' }),
      read: vi.fn<PlanningTransport['read']>(),
      lookup: vi.fn<PlanningTransport['lookup']>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: canonicalData() });
    await expect(h.controller.execute(h.controller.begin(), intent, inverse)).rejects.toMatchObject(
      {
        code: 'NO_CHANGE',
      },
    );
    expect(h.state().planning.outcome).toMatchObject({ kind: 'refused', code: 'NO_CHANGE' });
    expect(h.state().planning.history.past).toHaveLength(0);
  });

  it('does not create Undo for a committed delete lookup without its restoration handle', async () => {
    const deleteIntent = {
      operation: 'allocation.deleteGroup',
      ids: ['allocation-1'],
    } as PlanningIntent;
    const restoreIntent = {
      operation: 'planning.restoreGroup',
      restorationGroupId: '',
    } as PlanningIntent;
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockRejectedValue(new TypeError('offline'));
    const lookup = vi.fn<PlanningTransport['lookup']>(async (_context, mutationId) => ({
      status: 'committed',
      mutationId,
      revision: 2,
    }));
    const read = vi
      .fn()
      .mockResolvedValueOnce({ revision: 1, canWrite: true, data: canonicalData() })
      .mockResolvedValueOnce({ revision: 2, canWrite: true, data: canonicalData() });
    const h = harness({ execute, read, lookup });
    h.controller.setContext(context);
    await h.controller.refresh();
    const draft = h.controller.begin();
    await expect(h.controller.execute(draft, deleteIntent, restoreIntent)).rejects.toMatchObject({
      uncertain: true,
    });
    await h.controller.reconcile();
    expect(h.state().planning.outcome).toMatchObject({ kind: 'acknowledged', revision: 2 });
    expect(h.state().planning.history.past).toHaveLength(0);
  });

  it('reconciles lost Undo and Redo responses with each fresh restoration handle', async () => {
    const create = {
      operation: 'allocation.duplicate',
      sourceAllocationId: 'source-1',
      occurrence: { id: 'group-1', startDate: '2026-10-21', endDate: '2026-10-21' },
    } as PlanningIntent;
    const deleteIntent = {
      operation: 'allocation.deleteGroup',
      ids: ['group-1'],
    } as PlanningIntent;
    const restore = (restorationGroupId: string) =>
      ({ operation: 'planning.restoreGroup', restorationGroupId }) as PlanningIntent;
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockResolvedValueOnce(success('mutation-1', 2))
      .mockRejectedValue(new TypeError('offline'));
    const lookup = vi.fn<PlanningTransport['lookup']>(async (_context, mutationId) => ({
      status: 'committed',
      mutationId,
      revision: Number(mutationId.slice(-1)) + 1,
      ...(mutationId === 'mutation-2'
        ? { restorationGroupId: 'restore-undo' }
        : mutationId === 'mutation-4'
          ? { restorationGroupId: 'restore-redo' }
          : {}),
    }));
    let revision = 0;
    const read = vi.fn<PlanningTransport['read']>(async () => ({
      revision: ++revision,
      canWrite: true,
      data: canonicalData(),
    }));
    const h = harness({ execute, read, lookup });
    h.controller.setContext(context);
    await h.controller.refresh();
    await h.controller.execute(h.controller.begin(), create, deleteIntent);

    await expect(h.controller.undo()).rejects.toMatchObject({ uncertain: true });
    await h.controller.reconcile();
    expect(h.state().planning.history.future.at(-1)?.forward).toEqual(restore('restore-undo'));

    await expect(h.controller.redo()).rejects.toMatchObject({ uncertain: true });
    await h.controller.reconcile();
    expect(h.state().planning.history.past.at(-1)?.forward).toEqual(restore('restore-undo'));
    expect(h.state().planning.history.past.at(-1)?.inverse).toEqual(deleteIntent);

    await expect(h.controller.undo()).rejects.toMatchObject({ uncertain: true });
    await h.controller.reconcile();
    expect(h.state().planning.history.future.at(-1)?.forward).toEqual(restore('restore-redo'));
    expect(execute.mock.calls.map(([, execution]) => execution.baseRevision)).toEqual([1, 2, 3, 4]);
    expect(new Set(execute.mock.calls.map(([, execution]) => execution.mutationId)).size).toBe(4);
  });
});

describe('planning lookup history boundaries', () => {
  it('preserves Redo after a lost restore acknowledgement without a replacement handle', async () => {
    const remove: PlanningIntent = { operation: 'allocation.deleteGroup', ids: ['allocation-1'] };
    const restore: PlanningIntent = {
      operation: 'planning.restoreGroup',
      restorationGroupId: 'group-1',
    };
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockResolvedValueOnce({
        ...success('mutation-1', 2),
        restoration: { consumedGroupId: null, replacementGroupId: 'group-1' },
      })
      .mockRejectedValueOnce(new TypeError('restore response lost'))
      .mockResolvedValueOnce({
        ...success('mutation-3', 4),
        restoration: { consumedGroupId: null, replacementGroupId: 'group-2' },
      });
    const read = vi
      .fn<PlanningTransport['read']>()
      .mockResolvedValueOnce({ revision: 2, canWrite: true, data: canonicalData() })
      .mockResolvedValueOnce({ revision: 3, canWrite: true, data: canonicalData() })
      .mockResolvedValueOnce({ revision: 4, canWrite: true, data: canonicalData() });
    const lookup = vi
      .fn<PlanningTransport['lookup']>()
      .mockResolvedValueOnce({ status: 'committed', mutationId: 'mutation-2', revision: 3 });
    const h = harness({ execute, read, lookup });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: canonicalData() });
    await h.controller.execute(h.controller.begin(), remove, restore);
    await expect(h.controller.undo()).rejects.toMatchObject({ uncertain: true });
    await h.controller.reconcile();
    expect(h.state().planning.history.future.at(-1)?.forward).toEqual(remove);
    expect(await h.controller.redo()).toBe(true);
    expect(h.state().planning.history.past.at(-1)?.inverse).toEqual({
      operation: 'planning.restoreGroup',
      restorationGroupId: 'group-2',
    });
    expect(execute.mock.calls.map(([, execution]) => execution.mutationId)).toEqual([
      'mutation-1',
      'mutation-2',
      'mutation-3',
    ]);
    expect(execute.mock.calls.map(([, execution]) => execution.baseRevision)).toEqual([1, 2, 3]);
  });

  it('accepts lookup proof that arrives after an overlapping canonical refresh', async () => {
    const h = await uncertainHarness();
    const delayed = deferred<Awaited<ReturnType<PlanningTransport['lookup']>>>();
    h.lookup.mockImplementationOnce(() => delayed.promise);
    const reconcile = h.controller.reconcile();
    await h.controller.refresh();
    delayed.resolve({ status: 'committed', mutationId: 'mutation-1', revision: 2 });
    await reconcile;
    expect(h.state().planning.outcome).toMatchObject({ kind: 'acknowledged', revision: 2 });
    expect(h.state().planning.pending).toBeNull();
    expect(h.state().planning.history.past).toHaveLength(1);
  });

  it('retries only the canonical read after proven commitment and a failed read', async () => {
    const h = await uncertainHarness();
    h.lookup.mockResolvedValueOnce({ status: 'committed', mutationId: 'mutation-1', revision: 2 });
    h.read.mockRejectedValueOnce(new TypeError('read failed'));
    await h.controller.reconcile();
    expect(h.state().planning.pending?.commitment?.revision).toBe(2);
    await h.controller.reconcile();
    expect(h.lookup).toHaveBeenCalledOnce();
    expect(h.state().planning.history.past).toHaveLength(1);
    expect(h.state().planning.pending).toBeNull();
  });
});

describe.each(['receipt', 'lookup'] as const)('planning activity history via %s', (proof) => {
  it.each([true, false])(
    'applies the kind-present=%s boundary to existing past and future history',
    async (includesKind) => {
      const execute = vi.fn<PlanningTransport['execute']>((_context, execution) =>
        Promise.resolve(success(execution.mutationId, execution.baseRevision + 1)),
      );
      const read = vi.fn<PlanningTransport['read']>();
      const lookup = vi.fn<PlanningTransport['lookup']>();
      const h = harness({ execute, read, lookup });
      h.controller.setContext(context);
      await h.readSnapshot({ revision: 1, canWrite: true, data: canonicalData() });
      await h.controller.execute(h.controller.begin(), intent, inverse);
      await h.controller.execute(h.controller.begin(), intent, inverse);
      await h.controller.undo();
      expect(h.state().planning.history.past).toHaveLength(1);
      expect(h.state().planning.history.future).toHaveLength(1);
      const changes = {
        name: 'Facilities',
        ...(includesKind ? { kind: 'internal' as const } : {}),
      };
      const update: PlanningIntent = {
        operation: 'catalogue.update',
        entity: { entity: 'activities', id: 'activity-1', changes },
      };
      const reverse: PlanningIntent = {
        operation: 'catalogue.update',
        entity: { entity: 'activities', id: 'activity-1', changes: { ...changes, name: 'Office' } },
      };
      read.mockResolvedValueOnce({ revision: 5, canWrite: true, data: canonicalData() });
      if (proof === 'lookup') {
        execute.mockRejectedValueOnce(new TypeError('response lost'));
        lookup.mockImplementationOnce(async (_context, mutationId) => ({
          status: 'committed',
          mutationId,
          revision: 5,
        }));
        await expect(
          h.controller.execute(h.controller.begin(), update, reverse),
        ).rejects.toMatchObject({ uncertain: true });
        await h.controller.reconcile();
      } else {
        execute.mockImplementationOnce(async (_context, execution) => ({
          ...success(execution.mutationId, 5),
          ...(includesKind
            ? { projection: { mode: 'refetch' as const, history: 'clear' as const } }
            : {}),
        }));
        await h.controller.execute(h.controller.begin(), update, reverse);
      }
      expect(h.state().planning.history.past).toEqual(
        includesKind
          ? []
          : [
              { forward: intent, inverse },
              { forward: update, inverse: reverse },
            ],
      );
      expect(h.state().planning.history.future).toEqual([]);
      expect(h.state().planning.history.tipRevision).toBe(includesKind ? null : 5);
      expect(execute).toHaveBeenCalledTimes(4);
      expect(lookup).toHaveBeenCalledTimes(proof === 'lookup' ? 1 : 0);
    },
  );
});
