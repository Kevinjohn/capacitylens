import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { PlanningIntent, PlanningMutationSuccess } from '@/api/planningContracts';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import { makeAccount, makeAppData, makeClient } from '@/test/fixtures';
import {
  createPlanningCacheController,
  createPlanningCacheState,
  isPlanningHistoryReady,
  isShownByPlanningState,
  PlanningControllerError,
  readPlanningProblem,
} from './planningCacheController';
import type {
  PlanningCacheState,
  PlanningControllerOptions,
  PlanningSnapshot,
  PlanningTransport,
} from './planningCacheController';

// Pins the coordinator transitions that no other controller test asserts directly.

const context = { identity: 'bruce-session', companyId: 'wayne' };
const update: PlanningIntent = {
  operation: 'allocation.update',
  id: 'allocation-1',
  changes: { startDate: '2026-10-21' },
};
const inverse: PlanningIntent = {
  operation: 'allocation.update',
  id: 'allocation-1',
  changes: { startDate: '2026-10-20' },
};

function snapshot(revision: number, clientName = 'Wayne Enterprises'): PlanningSnapshot {
  return {
    revision,
    canWrite: true,
    accessKey: 'owner',
    data: makeAppData({
      accounts: [makeAccount({ id: 'wayne', name: 'Wayne Enterprises' })],
      clients: [makeClient({ id: 'client-1', accountId: 'wayne', name: clientName })],
    }),
  };
}

function receipt(
  mutationId: string,
  revision: number,
  overrides: Partial<PlanningMutationSuccess> = {},
): PlanningMutationSuccess {
  return {
    status: 'committed',
    mutationId,
    revision,
    restoration: { consumedGroupId: null, replacementGroupId: null },
    projection: { mode: 'patch', history: 'retain', changed: { upserts: [], removed: [] } },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

type Options = Pick<PlanningControllerOptions, 'onAuthLoss' | 'confirmRestorationCleanup'>;

function setup(options: Options = {}) {
  const store = createStore<PlanningCacheState>(() => createPlanningCacheState());
  const server = { revision: 1 };
  const read = vi.fn<PlanningTransport['read']>(async () => snapshot(server.revision));
  const execute = vi.fn<PlanningTransport['execute']>(async (_context, execution) => {
    server.revision = execution.baseRevision + 1;
    return receipt(execution.mutationId, server.revision);
  });
  const lookup = vi.fn<PlanningTransport['lookup']>();
  let id = 0;
  const controller = createPlanningCacheController({
    getState: store.getState,
    setState: store.setState,
    transport: { read, execute, lookup },
    createMutationId: () => `mutation-${++id}`,
    ...options,
  });
  const state = () => store.getState();
  return { store, state, server, read, execute, lookup, controller };
}

async function ready(options: Options = {}) {
  const h = setup(options);
  h.controller.setContext(context);
  await expect(h.controller.refresh()).resolves.toBe(true);
  return h;
}

/** Ready at revision 2 with one acknowledged Undo entry. */
async function readyWithHistory(options: Options = {}) {
  const h = await ready(options);
  await h.controller.execute(h.controller.begin({}), update, inverse);
  expect(h.state().planning.history.past).toHaveLength(1);
  expect(h.state().planning.revision).toBe(2);
  return h;
}

async function uncertain() {
  const h = await ready();
  h.execute.mockRejectedValueOnce(new TypeError('response lost'));
  await expect(h.controller.execute(h.controller.begin({}), update, inverse)).rejects.toMatchObject(
    { uncertain: true },
  );
  expect(h.state().planning.status).toBe('uncertain');
  return h;
}

describe('planning context transitions', () => {
  it('keeps rows, history and an in-flight read when an equal context is installed again', async () => {
    const h = await readyWithHistory();
    const read = deferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => read.promise);
    const refreshing = h.controller.refresh();
    const signal = h.read.mock.calls.at(-1)?.[1];
    h.controller.setContext({ ...context });
    expect(signal?.aborted).toBe(false);
    read.resolve(snapshot(2));
    await expect(refreshing).resolves.toBe(true);
    expect(h.state().planning.history.past).toHaveLength(1);
    expect(h.state().data.clients).toHaveLength(1);
  });

  it('aborts in-flight requests when the context is cleared', async () => {
    const h = await ready();
    const read = deferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => read.promise);
    const refreshing = h.controller.refresh();
    const signal = h.read.mock.calls.at(-1)?.[1];
    h.controller.setContext(null);
    expect(signal?.aborted).toBe(true);
    read.resolve(snapshot(5));
    await expect(refreshing).resolves.toBe(false);
    expect(h.state().planning).toMatchObject({ status: 'idle', revision: null, context: null });
    expect(h.state().data).toEqual(emptyAppData());
  });

  it('returns false without a read while no client context is installed', async () => {
    const h = setup();
    await expect(h.controller.refresh()).resolves.toBe(false);
    await expect(h.controller.reconcile()).resolves.toBe(false);
    await expect(h.controller.undo()).resolves.toBe(false);
    expect(h.read).not.toHaveBeenCalled();
    expect(h.state().planning.status).toBe('idle');
    expect(() => h.controller.begin({})).toThrow(/read-only/);
  });

  it('resets to ready at the imported revision and ignores a read started before a demo import', async () => {
    const h = await readyWithHistory();
    const read = deferred<PlanningSnapshot>();
    h.read.mockImplementationOnce(() => read.promise);
    const refreshing = h.controller.refresh();
    const signal = h.read.mock.calls.at(-1)?.[1];
    const planning = h.controller.invalidateAfterDemoImport(context, 9);
    expect(signal?.aborted).toBe(true);
    h.store.setState(() => ({ planning }));
    read.resolve(snapshot(2, 'Pre-import name'));
    await expect(refreshing).resolves.toBe(false);
    expect(h.state().planning).toMatchObject({
      status: 'ready',
      revision: 9,
      canWrite: true,
      pending: null,
      outcome: null,
      history: { past: [], future: [], tipRevision: null },
    });
    await expect(h.controller.undo()).resolves.toBe(false);
  });
});

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

describe('planning reconciliation transitions', () => {
  it.each([
    { name: 'a revision other than base + 1', mutationId: 'mutation-1', revision: 5 },
    { name: 'another mutation id', mutationId: 'mutation-9', revision: 2 },
  ])(
    'keeps the write uncertain when lookup answers with $name',
    async ({ mutationId, revision }) => {
      const h = await uncertain();
      h.lookup.mockResolvedValueOnce({ status: 'committed', mutationId, revision });
      await expect(h.controller.reconcile()).resolves.toBe(false);
      expect(h.state().planning.status).toBe('uncertain');
      expect(h.state().planning.outcome?.kind).toBe('uncertain');
      expect(h.state().planning.pending?.commitment).toBeUndefined();
      expect(h.state().planning.error).toBeInstanceOf(PlanningControllerError);

      h.lookup.mockResolvedValueOnce({
        status: 'committed',
        mutationId: 'mutation-1',
        revision: 2,
      });
      h.server.revision = 2;
      await expect(h.controller.reconcile()).resolves.toBe(true);
      expect(h.state().planning).toMatchObject({ status: 'ready', pending: null, error: null });
      expect(h.execute).toHaveBeenCalledOnce();
    },
  );

  it('keeps an uncertain write reconcilable after its lookup request fails', async () => {
    const h = await uncertain();
    const failure = new TypeError('lookup unavailable');
    h.lookup.mockRejectedValueOnce(failure);
    await expect(h.controller.reconcile()).resolves.toBe(false);
    expect(h.state().planning).toMatchObject({ status: 'uncertain', error: failure });
    expect(h.state().planning.pending?.execution.mutationId).toBe('mutation-1');

    h.lookup.mockResolvedValueOnce({ status: 'unknown', mutationId: 'mutation-1' });
    await expect(h.controller.reconcile()).resolves.toBe(false);
    expect(h.state().planning.status).toBe('uncertain');
    expect(h.execute).toHaveBeenCalledOnce();
  });

  it('keeps the write unresolved and writes locked across failed and successful reads until lookup proves it', async () => {
    const h = await uncertain();
    h.read.mockRejectedValueOnce(new TypeError('focus read failed'));
    await h.controller.refresh();
    expect(h.state().planning.status).toBe('error');
    expect(h.state().planning.outcome?.kind).toBe('uncertain');
    expect(() => h.controller.begin({})).toThrow();

    await expect(h.controller.refresh()).resolves.toBe(true);
    expect(h.state().planning.outcome?.kind).toBe('uncertain');
    expect(() => h.controller.begin({})).toThrow();
    expect(h.execute).toHaveBeenCalledOnce();

    h.lookup.mockResolvedValueOnce({ status: 'committed', mutationId: 'mutation-1', revision: 2 });
    h.server.revision = 2;
    await expect(h.controller.reconcile()).resolves.toBe(true);
    expect(h.state().planning).toMatchObject({ status: 'ready', pending: null });
  });
});

describe('planning history transitions', () => {
  it('refuses Undo and Redo while a write is unresolved or the history tip is behind', async () => {
    const h = await readyWithHistory();
    await h.controller.undo();
    expect(h.state().planning.history.future).toHaveLength(1);
    await h.controller.redo();
    expect(h.state().planning.history.past).toHaveLength(1);

    const response = deferred<PlanningMutationSuccess>();
    h.execute.mockImplementationOnce(() => response.promise);
    const write = h.controller.execute(h.controller.begin({}), update, inverse);
    await expect(h.controller.undo()).resolves.toBe(false);
    await expect(h.controller.redo()).resolves.toBe(false);
    h.server.revision = 5;
    response.resolve(receipt('mutation-4', 5));
    await write;
    const calls = h.execute.mock.calls.length;

    h.store.setState((state) => ({
      planning: {
        ...state.planning,
        history: { ...state.planning.history, tipRevision: (state.planning.revision ?? 0) - 1 },
      },
    }));
    expect(h.state().planning.history.past.length).toBeGreaterThan(0);
    await expect(h.controller.undo()).resolves.toBe(false);
    expect(isPlanningHistoryReady(h.state().planning)).toBe(false);
    expect(h.execute).toHaveBeenCalledTimes(calls);
  });

  it('clears both histories when Undo of a create commits without a restoration handle', async () => {
    const h = await readyWithHistory();
    const create = {
      operation: 'allocation.repeat',
      sourceAllocationId: 'allocation-1',
      occurrences: [{ id: 'allocation-2', startDate: '2026-10-21', endDate: '2026-10-21' }],
    } as PlanningIntent;
    const remove: PlanningIntent = { operation: 'allocation.deleteGroup', ids: ['allocation-2'] };
    await h.controller.execute(h.controller.begin({}), create, remove);
    expect(h.state().planning.history.past).toHaveLength(2);
    await expect(h.controller.undo()).resolves.toBe(true);
    expect(h.execute.mock.calls.at(-1)?.[1].intent).toEqual(remove);
    expect(h.state().planning.history).toEqual({ past: [], future: [], tipRevision: null });
  });

  it('clears history when Redo of a delete commits without a fresh restoration handle', async () => {
    const h = await ready();
    const remove: PlanningIntent = { operation: 'allocation.delete', id: 'allocation-1' };
    const restore: PlanningIntent = { operation: 'planning.restoreGroup', restorationGroupId: '' };
    h.execute.mockImplementationOnce(async (_context, execution) => {
      h.server.revision = 2;
      return receipt(execution.mutationId, 2, {
        restoration: { consumedGroupId: null, replacementGroupId: 'group-1' },
      });
    });
    await h.controller.execute(h.controller.begin({}), remove, restore);
    expect(h.state().planning.history.past.at(-1)?.inverse).toEqual({
      operation: 'planning.restoreGroup',
      restorationGroupId: 'group-1',
    });
    await expect(h.controller.undo()).resolves.toBe(true);
    expect(h.state().planning.history.future).toHaveLength(1);
    await expect(h.controller.redo()).resolves.toBe(true);
    expect(h.execute.mock.calls.at(-1)?.[1].intent).toEqual(remove);
    expect(h.state().planning.history).toEqual({ past: [], future: [], tipRevision: null });
  });

  it('turns Undo of a catalogue create into an unarchive Redo with the same entity', async () => {
    const h = await ready();
    const create = {
      operation: 'catalogue.create',
      entity: { entity: 'clients', id: 'client-2', fields: { name: 'Daily Planet' } },
    } as PlanningIntent;
    const archive = {
      operation: 'catalogue.archive',
      entity: { entity: 'clients', id: 'client-2' },
    } as PlanningIntent;
    await h.controller.execute(h.controller.begin({}), create, archive);
    await expect(h.controller.undo()).resolves.toBe(true);
    expect(h.state().planning.history.future).toEqual([
      {
        forward: {
          operation: 'catalogue.unarchive',
          entity: { entity: 'clients', id: 'client-2' },
        },
        inverse: archive,
      },
    ]);
    await expect(h.controller.redo()).resolves.toBe(true);
    expect(h.execute.mock.calls.at(-1)?.[1].intent).toEqual({
      operation: 'catalogue.unarchive',
      entity: { entity: 'clients', id: 'client-2' },
    });
    expect(h.state().planning.history.past.at(-1)?.inverse).toEqual(archive);
  });
});
