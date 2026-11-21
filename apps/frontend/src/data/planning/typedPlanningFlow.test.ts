import { getMasqueradeToken } from '@/api/masqueradeToken';
import { createStore } from 'zustand/vanilla';
import { describe, expect, it } from 'vitest';
import {
  makeCompany,
  makeActivity,
  makeAppData,
  makeClient,
  makeProject,
  requireValue,
} from '@/test/fixtures';
import { StubPlanningTransport } from '@/test/planning/stubPlanningTransport';
import { queuePlanningPatch } from '@/test/planning/queuePlanningPatch';
import { buildResourceCreate, buildSettingsUpdate } from './planningIntents';
import { createPlanningCache, createPlanningCacheState } from './planningCache';
import type { PlanningCacheState } from './planningCacheTypes';

const companyId = 'a1';
const context = { identity: 'test-page', companyId };

function flow(initial: PlanningCacheState['data']) {
  const store = createStore<PlanningCacheState>(() => createPlanningCacheState(initial));
  const transport = new StubPlanningTransport();
  transport.reset(companyId, initial);
  const cache = createPlanningCache({
    readMasqueradeToken: getMasqueradeToken,
    getState: store.getState,
    setState(update) {
      store.setState((state) => update(state));
    },
    transport,
  });
  cache.setContext(context);
  return { cache, state: store.getState, transport };
}

describe('typed planning flow', () => {
  it('publishes settings and takes them back and forward through Undo and Redo', async () => {
    const initial = makeAppData({
      accounts: [makeCompany({ id: companyId, dateStyle: null, timezone: null })],
    });
    const { cache, state } = flow(initial);
    await cache.refresh();
    const original = state().data.accounts[0];
    if (!original) throw new Error('Expected account.');
    const intentRequest = buildSettingsUpdate({
      data: state().data,
      companyId,
      original,
      args: { dateStyle: 'month-day', timezone: 'Europe/London' },
    });
    if (!intentRequest) throw new Error('Expected settings intent.');

    await cache.execute(cache.begin(), intentRequest.intent);
    expect(state().data.accounts[0]).toMatchObject({
      dateStyle: 'month-day',
      timezone: 'Europe/London',
    });
    expect(state().planning.revision).toBe(1);
    expect(state().planning.history.canUndo).toBe(true);

    await cache.undo();
    expect(state().data.accounts[0]).toMatchObject({ dateStyle: null, timezone: null });
    expect(state().planning.revision).toBe(2);
    await cache.redo();
    expect(state().data.accounts[0]).toMatchObject({
      dateStyle: 'month-day',
      timezone: 'Europe/London',
    });
    expect(state().planning.revision).toBe(3);
  });

  it('asks the server to undo a deletion and shows the rows it restores', async () => {
    const initial = makeAppData({
      accounts: [makeCompany({ id: companyId })],
      projects: [
        makeProject({
          id: 'p1',
          companyId,
          name: 'Planning',
          clientId: 'c1',
          color: '#da2d92',
        }),
      ],
      phases: [
        {
          id: 'phase-1',
          companyId,
          projectId: 'p1',
          name: 'Design',
          createdAt: 't',
          updatedAt: 't',
        },
      ],
      activities: [
        makeActivity({
          id: 'activity-1',
          companyId,
          name: 'Wireframes',
          kind: 'project',
          projectId: 'p1',
          phaseId: 'phase-1',
        }),
      ],
    });
    const { cache, state, transport } = flow(initial);
    await cache.refresh();
    const activityForDelete = requireValue(
      state().data.activities[0],
      'activity after phase delete',
    );
    queuePlanningPatch(
      () => ({
        removed: [{ entity: 'phases', id: 'phase-1' }],
        upserts: [
          {
            entity: 'activities',
            row: { ...activityForDelete, phaseId: null },
          },
        ],
      }),
      { replacementGroupId: 'phase-delete-group' },
      transport,
    );

    await cache.execute(cache.begin(), {
      operation: 'catalogue.delete',
      entity: { entity: 'phases', id: 'phase-1' },
    });
    expect(state().data.phases).toHaveLength(0);
    expect(state().data.activities[0]?.phaseId).toBeNull();
    expect(state().planning.history).toEqual({ canUndo: true, canRedo: false });

    await expect(cache.undo()).resolves.toBe(true);

    expect(transport.calls).toHaveLength(1);
    expect(transport.historySteps).toEqual(['undo']);
    expect(state().data.phases).toMatchObject([{ id: 'phase-1' }]);
    expect(state().data.activities[0]?.phaseId).toBe('phase-1');
  });

  it('undoes and redoes a resource creation without changing its id', async () => {
    const initial = makeAppData({ accounts: [makeCompany({ id: companyId })] });
    const { cache, state, transport } = flow(initial);
    await cache.refresh();
    const id = 'resource-1';
    const intentRequest = buildResourceCreate({
      data: state().data,
      companyId,
      args: {
        id,
        fields: {
          kind: 'person',
          name: 'Bruce Wayne',
          role: 'Designer',
          employmentType: 'permanent',
          engagement: 'studio',
          workingHoursPerDay: 8,
          workingDays: [1, 2, 3, 4, 5],
          halfDays: [],
          color: '#2d75da',
        },
      },
    });
    if (!intentRequest) throw new Error('Expected resource intent.');
    await cache.execute(cache.begin(), intentRequest.intent);
    await expect(cache.undo()).resolves.toBe(true);
    expect(state().data.resources.filter((row) => !row.archivedAt)).toEqual([]);
    expect(state().planning.history).toEqual({ canUndo: false, canRedo: true });
    await expect(cache.redo()).resolves.toBe(true);
    expect(state().data.resources).toHaveLength(1);
    expect(state().data.resources[0]?.id).toBe(id);
    expect(state().data.resources[0]?.archivedAt).toBeNull();
    expect(transport.calls.map(({ operation }) => operation)).toEqual(['resource.create']);
    expect(transport.historySteps).toEqual(['undo', 'redo']);
  });

  it('keeps a failed draft out of canonical rows while recording its sent intent', async () => {
    const client = makeClient({ id: 'client-1', companyId });
    const initial = makeAppData({
      accounts: [makeCompany({ id: companyId })],
      clients: [client],
    });
    const { cache, state, transport } = flow(initial);
    await cache.refresh();
    transport.failNext(new Error('server refusal'));

    await expect(
      cache.execute(cache.begin(), {
        operation: 'catalogue.update',
        entity: { entity: 'clients', id: client.id, changes: { name: 'Wayne Studio' } },
      }),
    ).rejects.toThrow('server refusal');

    expect(transport.calls).toEqual([
      {
        operation: 'catalogue.update',
        entity: { entity: 'clients', id: client.id, changes: { name: 'Wayne Studio' } },
      },
    ]);
    expect(state().data.clients[0]?.name).toBe('Ferris');
    expect(state().planning.revision).toBe(0);
  });
});
