import { readPlanningError } from './planningNotices';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyAppData } from '@capacitylens/shared/types/entities';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import type { PlanningSnapshot, PlanningTransport } from './planningCacheTypes';
import { setMasqueradeToken } from '@/api/masqueradeToken';
import {
  context,
  intent,
  makeCanonicalData,
  companyToday,
  makeReceipt,
  createHarness,
} from './planningCacheTestKit';
import { emptyCapacity } from '@/test/capacityFixtures';
import { makePlanningAccess } from '@/test/planning/planningAccessFixtures';
import { createDeferred } from '@/test/createDeferred';

afterEach(() => setMasqueradeToken(null));

describe('planning cache', () => {
  it('keeps the context proof captured with a planning action when status changes before execution', async () => {
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockResolvedValue(makeReceipt('mutation-1', 4));
    const h = createHarness({ execute, read: vi.fn() });
    setMasqueradeToken('captured-idle-context');
    h.cache.setContext(context);
    await h.readSnapshot({
      revision: 3,
      authority: makePlanningAccess(),
      data: makeCanonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });

    const draft = h.cache.begin();
    setMasqueradeToken('new-active-context');
    await h.cache.execute(draft, intent);

    expect(execute.mock.calls[0]?.[0]).toEqual({
      ...context,
      masqueradeToken: 'captured-idle-context',
    });
  });

  it('sends a canonical read with the proof current when the read is dispatched', async () => {
    const read = vi.fn<PlanningTransport['read']>().mockResolvedValue({
      revision: 3,
      authority: makePlanningAccess(),
      data: makeCanonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    const h = createHarness({ execute: vi.fn(), read });
    h.cache.setContext(context);
    setMasqueradeToken('current-context');

    await h.cache.refresh();

    expect(read.mock.calls[0]?.[0]).toEqual({
      ...context,
      masqueradeToken: 'current-context',
    });
  });

  it('ignores late reads from an invalidated client context and clears data/history atomically', async () => {
    let resolveRead!: (value: PlanningSnapshot) => void;
    const read = vi.fn<PlanningTransport['read']>(
      () =>
        new Promise<PlanningSnapshot>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const h = createHarness({
      execute: vi.fn<PlanningTransport['execute']>(),
      read,
    });
    h.cache.setContext(context);
    const readPromise = h.cache.refresh();
    h.cache.setContext(null);
    resolveRead({
      revision: 9,
      authority: makePlanningAccess(),
      data: { ...createEmptyAppData(), accounts: [{ id: 'leak' } as never] },
      today: companyToday,
      capacity: emptyCapacity(),
    });
    await readPromise;
    expect(h.state().data).toEqual(createEmptyAppData());
    expect(h.state().planning.revision).toBeNull();
    expect(h.state().planning.history.canUndo).toBe(false);
  });

  it('ignores an old success after switching away and back to an otherwise identical context', async () => {
    let release!: (receipt: PlanningMutationSuccess) => void;
    const execute = vi.fn<PlanningTransport['execute']>(
      () =>
        new Promise<PlanningMutationSuccess>((resolve) => {
          release = resolve;
        }),
    );
    const h = createHarness({
      execute,
      read: vi.fn<PlanningTransport['read']>(),
    });
    const anonymousIdentity = Symbol('anonymous');
    const anonymous = { identity: anonymousIdentity, companyId: 'company-1' };
    h.cache.setContext(anonymous);
    await h.readSnapshot({
      revision: 1,
      authority: makePlanningAccess(),
      data: makeCanonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    const write = h.cache.execute(h.cache.begin(), intent).catch(() => undefined);
    h.cache.setContext({ identity: anonymousIdentity, companyId: 'company-2' });
    h.cache.setContext(anonymous);
    await h.readSnapshot({
      revision: 7,
      authority: makePlanningAccess(),
      data: makeCanonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    release(makeReceipt('mutation-1', 2));
    await write;
    expect(h.state().planning.revision).toBe(7);
    expect(h.state().planning.phase).toEqual({ kind: 'ready', lastWrite: null });
    expect(h.state().planning.history.canUndo).toBe(false);
  });

  it('copies client context so caller mutation cannot rebind the active company', () => {
    const h = createHarness({
      execute: vi.fn<PlanningTransport['execute']>(),
      read: vi.fn<PlanningTransport['read']>(),
    });
    const callerContext = { identity: 'actor-1', companyId: 'company-1' };
    h.cache.setContext(callerContext);
    callerContext.companyId = 'company-2';
    expect(h.state().planning.context).toEqual({ identity: 'actor-1', companyId: 'company-1' });
  });
});

describe('planning receipt completion context', () => {
  for (const action of ['execute', 'undo', 'redo'] as const) {
    it.each(['sign-out', 'company switch', 'authority change'] as const)(
      `suppresses ${action} completion after %s during the acknowledged read`,
      async (change) => {
        const execute = vi.fn<PlanningTransport['execute']>((_context, execution) =>
          Promise.resolve(makeReceipt(execution.mutationId, execution.baseRevision + 1)),
        );
        const read = vi.fn<PlanningTransport['read']>();
        const h = createHarness({ execute, read });
        h.cache.setContext(context);
        await h.readSnapshot({
          revision: 1,
          data: makeCanonicalData(),
          today: companyToday,
          capacity: emptyCapacity(),
          authority: makePlanningAccess(),
        });
        await h.cache.execute(h.cache.begin(), intent);
        if (action === 'redo') await h.cache.undo();
        const baseRevision = h.state().planning.revision;
        if (baseRevision === null) throw new Error('Expected an initialized planning revision.');
        const revision = baseRevision + 1;
        const delayed = createDeferred<PlanningSnapshot>();
        read.mockImplementationOnce(() => delayed.promise);
        const completion =
          action === 'execute' ? h.cache.execute(h.cache.begin(), intent) : h.cache[action]();
        await vi.waitFor(() =>
          expect(h.state().planning.phase).toMatchObject({
            kind: 'writing',
            write: { commitment: { revision } },
          }),
        );
        if (change === 'sign-out') h.cache.setContext(null);
        if (change === 'company switch') {
          h.cache.setContext({ ...context, companyId: 'company-2' });
        }
        delayed.resolve({
          revision,
          authority: makePlanningAccess({
            role: change === 'authority change' ? 'editor' : 'owner',
          }),
          data: makeCanonicalData(),
          today: companyToday,
          capacity: emptyCapacity(),
        });
        await expect(completion).resolves.toBe(action === 'execute' ? null : false);
        expect(h.state().planning.phase).toEqual(
          change === 'sign-out' ? { kind: 'idle' } : expect.objectContaining({ lastWrite: null }),
        );
        expect(h.state().planning.history).toEqual({ canUndo: false, canRedo: false });
        expect(readPlanningError(h.state().planning.phase)).toBeNull();
        expect(execute).toHaveBeenCalledTimes(action === 'execute' ? 2 : 1);
      },
    );
  }
});
