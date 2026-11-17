import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { PlanningIntent, PlanningMutationSuccess } from '@/api/planningContracts';
import type { PlanningSnapshot, PlanningTransport } from './planningCacheTypes';
import { setMasqueradeContextToken } from '@/api/masqueradeContext';
import {
  context,
  intent,
  inverse,
  canonicalData,
  success,
  harness,
} from './planningCacheController.testSupport';

afterEach(() => setMasqueradeContextToken(null));

describe('planning cache controller', () => {
  it('accepts a matching commitment after a read reaches the pending write revision, then clears history on a later external revision', async () => {
    let release!: (receipt: PlanningMutationSuccess) => void;
    const execute = vi.fn<PlanningTransport['execute']>(
      () =>
        new Promise<PlanningMutationSuccess>((resolve) => {
          release = resolve;
        }),
    );
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport['read']>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: canonicalData() });
    const draft = h.controller.begin();
    const write = h.controller.execute(draft, intent, inverse);
    await h.readSnapshot({ revision: 2, canWrite: true, data: canonicalData() });
    expect(h.state().planning.history.past).toHaveLength(0);
    release(success('mutation-1', 2));
    await write;
    expect(h.state().planning.history.past).toHaveLength(1);
    await h.readSnapshot({ revision: 3, canWrite: true, data: canonicalData() });
    expect(h.state().planning.history.past).toHaveLength(0);
  });

  it.each([
    {},
    {
      revision: 2,
      canWrite: true,
      data: { ...emptyAppData(), accounts: [{ id: 'other-company' }] },
    },
    {
      revision: 3,
      data: { ...emptyAppData(), accounts: [{ id: 'company-1', name: 'Unverified' }] },
    },
    { revision: 4, canWrite: true, data: { ...canonicalData(), accounts: [] } },
    {
      revision: 5,
      canWrite: true,
      data: {
        ...canonicalData(),
        accounts: [...canonicalData().accounts, ...canonicalData().accounts],
      },
    },
  ])('surfaces invalid canonical reads instead of remaining loading: %j', async (snapshot) => {
    const read = vi.fn<PlanningTransport['read']>().mockResolvedValue(snapshot as PlanningSnapshot);
    const h = harness({ execute: vi.fn(), read });
    h.controller.setContext(context);
    await expect(h.controller.refresh()).resolves.toBe(false);
    expect(h.state().planning.status).toBe('error');
    expect(h.state().planning.error).toBeInstanceOf(Error);
    expect(h.state().data).toEqual(emptyAppData());
    expect(h.state().planning.canWrite).toBe(false);
    expect(h.state().planning.history.past).toHaveLength(0);
    expect(() => h.controller.begin()).toThrow(/read-only/);
  });

  it.each([
    {
      action: { operation: 'settings.update', changes: { timezone: 'Europe/London' } },
      retainedEntries: 1,
    },
    {
      action: {
        operation: 'catalogue.update',
        entity: { entity: 'clients', id: 'client-1', changes: { codeName: 'Wayne' } },
      },
      retainedEntries: 0,
    },
    {
      action: {
        operation: 'catalogue.update',
        entity: { entity: 'activities', id: 'activity-1', changes: { kind: 'internal' } },
      },
      retainedEntries: 0,
    },
  ] as Array<{ action: PlanningIntent; retainedEntries: number }>)(
    'keeps receipt-proven history according to the changed domain: %j',
    async ({ action, retainedEntries }) => {
      const execute = vi.fn<PlanningTransport['execute']>(async (_context, execution) =>
        success(execution.mutationId, 2),
      );
      const h = harness({ execute, read: vi.fn<PlanningTransport['read']>() });
      h.controller.setContext(context);
      await h.readSnapshot({ revision: 1, canWrite: true, data: canonicalData() });
      await h.controller.execute(h.controller.begin(), action, inverse);
      expect(h.state().planning.outcome).toMatchObject({ kind: 'acknowledged', revision: 2 });
      expect(h.state().planning.history.past).toHaveLength(retainedEntries);
    },
  );
});
