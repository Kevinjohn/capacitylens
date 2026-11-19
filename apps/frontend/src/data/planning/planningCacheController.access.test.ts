import { readPlanningError } from './planningNotices';
import { getMasqueradeContextToken } from '@/api/masqueradeContext';
import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { makeCompany, makeAppData, makeClient } from '@/test/fixtures';
import { createPlanningCacheController, createPlanningCacheState } from './planningCacheController';
import { PlanningControllerError } from './planningErrors';
import type { PlanningSnapshot, PlanningTransport } from './planningCacheTypes';
import { emptyCapacity } from '@/test/capacityFixtures';
import { makePlanningAuthority } from '@/test/planning/planningAuthorityFixtures';

type RequestStage = 'read' | 'execute';
type Success = Awaited<ReturnType<PlanningTransport['execute']>>;

const context = { identity: 'bruce-session-1', companyId: 'wayne' };
const update = {
  operation: 'allocation.update',
  id: 'allocation-1',
  changes: { startDate: '2026-10-21' },
} as const;

function snapshot(name: string, revision = 1): PlanningSnapshot {
  return {
    revision,
    authority: makePlanningAuthority(),
    data: makeAppData({
      accounts: [makeCompany({ id: 'wayne', name: 'Wayne Enterprises' })],
      clients: [makeClient({ companyId: 'wayne', name })],
    }),
    today: '2026-06-03',
    capacity: emptyCapacity(),
    history: { canUndo: true, canRedo: false },
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

async function setup() {
  const store = createStore(() => createPlanningCacheState());
  const read = vi.fn<PlanningTransport['read']>().mockResolvedValue(snapshot('Wayne Enterprises'));
  const execute = vi.fn<PlanningTransport['execute']>();
  const controller = createPlanningCacheController({
    readMasqueradeContextToken: getMasqueradeContextToken,
    getState: store.getState,
    setState: store.setState,
    transport: { read, execute, undo: vi.fn(), redo: vi.fn() },
  });
  controller.setContext(context);
  await controller.refresh();
  return { store, controller, read, execute };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function startRequest(fixture: Fixture, stage: RequestStage): Promise<unknown> {
  if (stage === 'read') return fixture.controller.refresh();
  return fixture.controller.execute(fixture.controller.begin(), update);
}

function rejectStage(fixture: Fixture, stage: RequestStage, error: Error) {
  if (stage === 'read') fixture.read.mockRejectedValueOnce(error);
  else fixture.execute.mockRejectedValueOnce(error);
}

describe('planning request access boundaries', () => {
  it('rejects a canonical snapshot with duplicate active-company rows', async () => {
    const fixture = await setup();
    const duplicateCompany = makeCompany({ id: 'wayne', name: 'Wayne Enterprises' });
    fixture.read.mockResolvedValueOnce({
      ...snapshot('Wayne Enterprises', 2),
      data: makeAppData({ accounts: [duplicateCompany, duplicateCompany] }),
    });

    await expect(fixture.controller.refresh()).resolves.toBe(false);
    expect(fixture.store.getState().planning.phase.kind).toBe('failed');
    expect(fixture.store.getState().planning.revision).toBe(1);
  });

  for (const stage of ['read', 'execute'] as const) {
    it(`clears rows, history and pending state atomically after ${stage} reports 401`, async () => {
      const fixture = await setup();
      const publications: boolean[] = [];
      fixture.store.subscribe((state) => {
        if (state.planning.context === null) {
          publications.push(
            state.data.clients.length === 0 &&
              !state.planning.history.canUndo &&
              !state.planning.history.canRedo &&
              state.planning.phase.kind !== 'writing',
          );
        }
      });
      rejectStage(fixture, stage, new PlanningControllerError('Access ended', undefined, 401));
      await startRequest(fixture, stage).catch((error: unknown) => error);
      expect(fixture.store.getState().planning.context).toBeNull();
      expect(fixture.store.getState().data.clients).toEqual([]);
      expect(publications).toEqual([true]);
    });

    // K2: every 403 keeps data and history and shows the refusal; nothing finer.
    for (const code of ['AUTHORIZATION_DENIED', 'ACCOUNT_MEMBERSHIP_LOST']) {
      it(`keeps readable rows and history and shows the refusal after ${stage} reports 403/${code}`, async () => {
        const fixture = await setup();
        const history = fixture.store.getState().planning.history;
        rejectStage(fixture, stage, new PlanningControllerError('Action refused', code, 403));
        await startRequest(fixture, stage).catch((error: unknown) => error);
        const state = fixture.store.getState();
        expect(state.planning.context).toEqual(context);
        expect(state.data.clients[0]?.name).toBe('Wayne Enterprises');
        expect(state.planning.history).toEqual(history);
        expect(readPlanningError(state.planning.phase)).toMatchObject({ code, status: 403 });
      });
    }

    it(`ignores a delayed ${stage} access-loss error after a new context has loaded`, async () => {
      const fixture = await setup();
      const pending = deferred<never>();
      if (stage === 'read') fixture.read.mockImplementationOnce(() => pending.promise);
      else fixture.execute.mockImplementationOnce(() => pending.promise);
      const oldRequest = startRequest(fixture, stage).catch((error: unknown) => error);
      fixture.controller.setContext({ ...context, identity: 'diana-session-2' });
      fixture.read.mockResolvedValueOnce({
        ...snapshot('Gotham', 2),
        authority: makePlanningAuthority({ role: 'editor' }),
      });
      await fixture.controller.refresh();
      pending.reject(new PlanningControllerError('Previous session ended', undefined, 401));
      await oldRequest;
      expect(fixture.store.getState().planning.context?.identity).toBe('diana-session-2');
      expect(fixture.store.getState().data.clients[0]?.name).toBe('Gotham');
      expect(readPlanningError(fixture.store.getState().planning.phase)).toBeNull();
    });
  }

  it('rejects an old mutation response after canonical authority changes inside the same company', async () => {
    const fixture = await setup();
    const pending = deferred<Success>();
    fixture.execute.mockImplementationOnce(() => pending.promise);
    const draft = fixture.controller.begin();
    const oldRequest = fixture.controller.execute(draft, update).catch((error: unknown) => error);
    const { phase } = fixture.store.getState().planning;
    const execution = phase.kind === 'writing' ? phase.write.execution : undefined;
    expect(execution).toBeDefined();
    fixture.read.mockResolvedValueOnce({
      ...snapshot('Gotham', 2),
      authority: makePlanningAuthority({ role: 'editor' }),
    });
    await fixture.controller.refresh();
    pending.resolve({
      status: 'committed',
      mutationId: execution?.mutationId ?? 'missing',
      revision: 2,
      restoration: { consumedGroupId: null, replacementGroupId: null },
    });
    await oldRequest;
    expect(fixture.store.getState().data.clients[0]?.name).toBe('Gotham');
    expect(fixture.store.getState().planning.history).toEqual({ canUndo: false, canRedo: false });
    expect(fixture.store.getState().planning.phase.kind).not.toBe('writing');
    await expect(fixture.controller.execute(draft, update)).rejects.toThrow(/context/i);
  });
});
