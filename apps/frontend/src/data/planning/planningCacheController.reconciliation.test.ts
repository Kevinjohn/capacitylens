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
  deferred,
  uncertainHarness,
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
      lookup: vi.fn<PlanningTransport['lookup']>(),
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

  it('keeps a committed lookup acknowledged when its canonical read fails and does not enable another write', async () => {
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockRejectedValue(new TypeError('offline'));
    const read = vi
      .fn()
      .mockResolvedValueOnce({ revision: 1, canWrite: true, data: canonicalData() })
      .mockRejectedValue(new TypeError('read unavailable'));
    const lookup = vi.fn<PlanningTransport['lookup']>(async (_context, mutationId) => ({
      status: 'committed',
      mutationId,
      revision: 2,
    }));
    const h = harness({ execute, read, lookup });
    h.controller.setContext(context);
    await h.controller.refresh();
    const draft = h.controller.begin();
    await expect(h.controller.execute(draft, intent, inverse)).rejects.toMatchObject({
      uncertain: true,
    });
    await h.controller.reconcile();
    expect(h.state().planning.outcome).toMatchObject({ kind: 'acknowledged', revision: 2 });
    expect(h.state().planning.status).toBe('error');
    expect(h.state().planning.pending).not.toBeNull();
    expect(() => h.controller.begin()).toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('planning reconciliation races', () => {
  it('ignores an older lookup failure after a newer reconciliation completed', async () => {
    const h = await uncertainHarness();
    const old = deferred<Awaited<ReturnType<PlanningTransport['lookup']>>>();
    h.lookup
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValueOnce({ status: 'committed', mutationId: 'mutation-1', revision: 2 });
    const first = h.controller.reconcile();
    await h.controller.reconcile();
    old.reject(new TypeError('old lookup failed'));
    await first;
    expect(h.state().planning.status).toBe('ready');
    expect(h.state().planning.pending).toBeNull();
    expect(h.state().planning.history.past).toHaveLength(1);
    expect(h.state().planning.error).toBeNull();
  });

  it('keeps unknown commitment reconcilable after a focus read fails', async () => {
    const h = await uncertainHarness();
    h.read.mockRejectedValueOnce(new TypeError('focus read failed'));
    await h.controller.refresh();
    h.lookup.mockResolvedValueOnce({ status: 'committed', mutationId: 'mutation-1', revision: 2 });
    await h.controller.reconcile();
    expect(h.lookup).toHaveBeenCalledOnce();
    expect(h.state().planning.status).toBe('ready');
    expect(h.state().planning.history.past).toHaveLength(1);
  });

  it('preserves commitment proof and history when a focus read supersedes the reconciliation read', async () => {
    const h = await uncertainHarness();
    const delayedRead = deferred<PlanningSnapshot>();
    h.lookup.mockResolvedValueOnce({ status: 'committed', mutationId: 'mutation-1', revision: 2 });
    h.read.mockImplementationOnce(() => delayedRead.promise);
    const reconciliation = h.controller.reconcile();
    await vi.waitFor(() => expect(h.read).toHaveBeenCalledOnce());
    expect(h.state().planning.outcome).toMatchObject({ kind: 'acknowledged', revision: 2 });
    await h.controller.refresh();
    delayedRead.reject(new TypeError('superseded read failed'));
    await reconciliation;
    expect(h.state().planning.status).toBe('ready');
    expect(h.state().planning.pending).toBeNull();
    expect(h.state().planning.history.past).toHaveLength(1);
    expect(h.state().planning.error).toBeNull();
  });

  it('drops confidential cached rows when reconciliation reads an older changed authority', async () => {
    const h = await uncertainHarness();
    await h.readSnapshot({
      revision: 3,
      canWrite: true,
      data: canonicalData({ name: 'Wayne confidential' }),
      accessKey: 'owner',
    });
    h.lookup.mockResolvedValueOnce({ status: 'committed', mutationId: 'mutation-1', revision: 2 });
    h.read.mockResolvedValueOnce({
      revision: 2,
      canWrite: true,
      data: canonicalData(),
      accessKey: 'editor',
    });
    await h.controller.reconcile();
    expect(h.state().data).toEqual(emptyAppData());
    expect(h.state().planning.pending).toBeNull();
    expect(h.state().planning.revision).toBeNull();
    expect(h.state().planning.status).toBe('error');
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
    const h = harness({ execute: vi.fn(), lookup: vi.fn(), read });
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
    'reconciles lookup-proven history according to the changed domain: %j',
    async ({ action, retainedEntries }) => {
      const h = await uncertainHarness();
      // Start a distinct operation so its submitted intent drives lookup eligibility.
      h.controller.setContext(null);
      h.controller.setContext(context);
      await h.readSnapshot({ revision: 1, canWrite: true, data: canonicalData() });
      await expect(
        h.controller.execute(h.controller.begin(), action, inverse),
      ).rejects.toMatchObject({
        uncertain: true,
      });
      h.lookup.mockResolvedValueOnce({
        status: 'committed',
        mutationId: 'mutation-2',
        revision: 2,
      });
      await h.controller.reconcile();
      expect(h.state().planning.history.past).toHaveLength(retainedEntries);
    },
  );
});

describe('planning commitment-only completion', () => {
  it.each(['execute', 'undo', 'redo'] as const)(
    'keeps %s acknowledged and locked after lookup proof followed by a failed read',
    async (action) => {
      const execute = vi.fn<PlanningTransport['execute']>((_context, execution) =>
        Promise.resolve(success(execution.mutationId, execution.baseRevision + 1)),
      );
      const read = vi.fn<PlanningTransport['read']>();
      const lookup = vi.fn<PlanningTransport['lookup']>();
      const h = harness({ execute, read, lookup });
      h.controller.setContext(context);
      await h.readSnapshot({ revision: 1, canWrite: true, data: canonicalData() });
      await h.controller.execute(h.controller.begin(), intent, inverse);
      if (action === 'redo') await h.controller.undo();
      const baseRevision = h.state().planning.revision;
      if (baseRevision === null) throw new Error('Expected an initialized planning revision.');
      const revision = baseRevision + 1;
      execute.mockRejectedValueOnce({ status: 409, code: 'MUTATION_ID_REUSED' });
      lookup.mockImplementationOnce(async (_context, mutationId) => ({
        status: 'committed',
        mutationId,
        revision,
      }));
      read.mockRejectedValueOnce(new TypeError('read unavailable'));
      const completion =
        action === 'execute'
          ? h.controller.execute(h.controller.begin(), intent, inverse)
          : h.controller[action]();
      await expect(completion).resolves.toBe(action === 'execute' ? null : true);
      expect(h.state().planning.outcome).toMatchObject({ kind: 'acknowledged', revision });
      expect(h.state().planning.pending?.commitment?.revision).toBe(revision);
      expect(h.state().planning.status).toBe('error');
      expect(() => h.controller.begin()).toThrow();
      read.mockResolvedValueOnce({ revision, canWrite: true, data: canonicalData() });
      await expect(h.controller.reconcile()).resolves.toBe(true);
      expect(h.state().planning.pending).toBeNull();
      expect(h.state().planning.status).toBe('ready');
      expect(lookup).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledTimes(action === 'redo' ? 3 : 2);
    },
  );

  it('keeps a reused mutation uncertain when lookup has no commitment proof', async () => {
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockRejectedValue({ status: 409, code: 'MUTATION_ID_REUSED' });
    const lookup = vi.fn<PlanningTransport['lookup']>(async (_context, mutationId) => ({
      status: 'unknown',
      mutationId,
    }));
    const h = harness({ execute, lookup, read: vi.fn<PlanningTransport['read']>() });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: canonicalData() });
    await expect(h.controller.execute(h.controller.begin(), intent, inverse)).rejects.toMatchObject(
      {
        uncertain: true,
      },
    );
    expect(h.state().planning.outcome?.kind).toBe('uncertain');
    expect(h.state().planning.pending?.commitment).toBeUndefined();
    expect(() => h.controller.begin()).toThrow();
    expect(execute).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledOnce();
  });
});
