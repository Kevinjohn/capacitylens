import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanningIntent } from '@/api/planningContracts';
import type { PlanningTransport } from './planningCacheTypes';
import { setMasqueradeContextToken } from '@/api/masqueradeContext';
import {
  context,
  intent,
  inverse,
  canonicalData,
  companyToday,
  success,
  harness,
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
    });
    h.controller.setContext(context);
    await h.readSnapshot({
      revision: 0,
      canWrite: true,
      data: canonicalData(),
      today: companyToday,
    });
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
    });
    h.controller.setContext(context);
    await h.readSnapshot({
      revision: 1,
      canWrite: true,
      data: canonicalData(),
      today: companyToday,
    });
    const draft = h.controller.begin();
    await h.controller.execute(draft, intent, inverse);
    expect(h.state().planning.history.past).toHaveLength(1);
    await h.readSnapshot({
      revision: 2,
      canWrite: true,
      data: canonicalData(),
      today: companyToday,
    });
    expect(h.state().planning.history.past).toHaveLength(1);
    await h.readSnapshot({
      revision: 3,
      canWrite: true,
      data: canonicalData(),
      today: companyToday,
    });
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
    });
    h.controller.setContext(context);
    await h.readSnapshot({
      revision: 1,
      canWrite: true,
      data: canonicalData(),
      today: companyToday,
    });
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
    });
    h.controller.setContext(context);
    await h.readSnapshot({
      revision: 1,
      canWrite: true,
      data: canonicalData(),
      today: companyToday,
    });
    await expect(h.controller.execute(h.controller.begin(), intent, inverse)).rejects.toMatchObject(
      {
        code: 'NO_CHANGE',
      },
    );
    expect(h.state().planning.outcome).toMatchObject({ kind: 'refused', code: 'NO_CHANGE' });
    expect(h.state().planning.history.past).toHaveLength(0);
  });

  it('does not create Undo for a committed delete receipt without its restoration handle', async () => {
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
      .mockImplementation(async (_context, execution) => success(execution.mutationId, 2));
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        revision: 1,
        canWrite: true,
        data: canonicalData(),
        today: companyToday,
      })
      .mockResolvedValueOnce({
        revision: 2,
        canWrite: true,
        data: canonicalData(),
        today: companyToday,
      });
    const h = harness({ execute, read });
    h.controller.setContext(context);
    await h.controller.refresh();
    await h.controller.execute(h.controller.begin(), deleteIntent, restoreIntent);
    expect(h.state().planning.outcome).toMatchObject({ kind: 'acknowledged', revision: 2 });
    expect(h.state().planning.history.past).toHaveLength(0);
  });
});

describe('planning activity history via a receipt', () => {
  it.each([true, false])(
    'applies the kind-present=%s boundary to existing past and future history',
    async (includesKind) => {
      const execute = vi.fn<PlanningTransport['execute']>((_context, execution) =>
        Promise.resolve(success(execution.mutationId, execution.baseRevision + 1)),
      );
      const read = vi.fn<PlanningTransport['read']>();
      const h = harness({ execute, read });
      h.controller.setContext(context);
      await h.readSnapshot({
        revision: 1,
        canWrite: true,
        data: canonicalData(),
        today: companyToday,
      });
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
      read.mockResolvedValueOnce({
        revision: 5,
        canWrite: true,
        data: canonicalData(),
        today: companyToday,
      });
      execute.mockImplementationOnce(async (_context, execution) =>
        success(execution.mutationId, 5),
      );
      await h.controller.execute(h.controller.begin(), update, reverse);
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
    },
  );
});
