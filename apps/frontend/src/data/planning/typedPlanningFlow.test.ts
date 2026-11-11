import { createStore } from 'zustand/vanilla';
import { describe, expect, it } from 'vitest';
import {
  makeAccount,
  makeActivity,
  makeAppData,
  makeClient,
  makeProject,
  requireValue,
} from '@/test/fixtures';
import { StubPlanningTransport } from '@/test/planning/stubPlanningTransport';
import { buildResourceCreate, buildSettingsUpdate } from './planningCommands';
import { createPlanningCacheController, createPlanningCacheState } from './planningCacheController';
import type { PlanningCacheState } from './planningCacheController';
import type { PlanningExecution, PlanningMutationSuccess } from '@/api/planningContracts';

const companyId = 'a1';
const context = { identity: 'test-page', companyId };

function flow(initial: PlanningCacheState['data']) {
  const store = createStore<PlanningCacheState>(() => createPlanningCacheState(initial));
  const transport = new StubPlanningTransport();
  transport.reset(companyId, initial);
  const controller = createPlanningCacheController({
    getState: store.getState,
    setState(update) {
      store.setState((state) => update(state));
    },
    transport,
  });
  controller.setContext(context);
  return { controller, state: store.getState, transport };
}

function respondWithPatch(
  transport: StubPlanningTransport,
  changed: Extract<PlanningMutationSuccess['projection'], { mode: 'patch' }>['changed'],
  options: { consumedGroupId?: string | null; replacementGroupId?: string | null } = {},
): void {
  const consumedGroupId = options.consumedGroupId ?? null;
  const replacementGroupId = options.replacementGroupId ?? null;
  if (consumedGroupId !== null && replacementGroupId !== null) {
    throw new Error('A planning restoration receipt cannot consume and replace a group together.');
  }
  transport.respondNext((execution: PlanningExecution) => ({
    status: 'committed',
    mutationId: execution.mutationId,
    revision: execution.baseRevision + 1,
    restoration:
      consumedGroupId !== null
        ? { consumedGroupId, replacementGroupId: null }
        : replacementGroupId !== null
          ? { consumedGroupId: null, replacementGroupId }
          : { consumedGroupId: null, replacementGroupId: null },
    projection: { mode: 'patch', history: 'retain', changed },
  }));
}

describe('typed planning flow', () => {
  it('publishes settings and keeps their inverse through Undo and Redo', async () => {
    const initial = makeAppData({
      accounts: [makeAccount({ id: companyId, dateStyle: null, timezone: null })],
    });
    const { controller, state } = flow(initial);
    await controller.refresh();
    const original = state().data.accounts[0];
    if (!original) throw new Error('Expected account.');
    const command = buildSettingsUpdate({
      data: state().data,
      accountId: companyId,
      original,
      args: { dateStyle: 'month-day', timezone: 'Europe/London' },
    });
    if (!command) throw new Error('Expected settings command.');

    await controller.execute(controller.begin(original), command.intent, command.inverse);
    expect(state().data.accounts[0]).toMatchObject({
      dateStyle: 'month-day',
      timezone: 'Europe/London',
    });
    expect(state().planning.revision).toBe(1);
    expect(state().planning.history.past).toHaveLength(1);

    await controller.undo();
    expect(state().data.accounts[0]).toMatchObject({ dateStyle: null, timezone: null });
    expect(state().planning.revision).toBe(2);
    await controller.redo();
    expect(state().data.accounts[0]).toMatchObject({
      dateStyle: 'month-day',
      timezone: 'Europe/London',
    });
    expect(state().planning.revision).toBe(3);
  });

  it('binds Undo to the restoration handle returned with a deletion receipt', async () => {
    const initial = makeAppData({
      accounts: [makeAccount({ id: companyId })],
      projects: [
        makeProject({
          id: 'p1',
          accountId: companyId,
          name: 'Planning',
          clientId: 'c1',
          color: '#da2d92',
        }),
      ],
      phases: [
        {
          id: 'phase-1',
          accountId: companyId,
          projectId: 'p1',
          name: 'Design',
          createdAt: 't',
          updatedAt: 't',
        },
      ],
      activities: [
        makeActivity({
          id: 'activity-1',
          accountId: companyId,
          name: 'Wireframes',
          kind: 'project',
          projectId: 'p1',
          phaseId: 'phase-1',
        }),
      ],
    });
    const { controller, state, transport } = flow(initial);
    await controller.refresh();
    const activityForDelete = requireValue(
      state().data.activities[0],
      'activity after phase delete',
    );
    respondWithPatch(
      transport,
      {
        removed: [{ entity: 'phases', id: 'phase-1' }],
        upserts: [
          {
            entity: 'activities',
            row: { ...activityForDelete, phaseId: null },
          },
        ],
      },
      { replacementGroupId: 'phase-delete-group' },
    );

    await controller.execute(
      controller.begin(null),
      { operation: 'catalogue.delete', entity: { entity: 'phases', id: 'phase-1' } },
      { operation: 'planning.restoreGroup', restorationGroupId: '' },
    );
    expect(state().data.phases).toHaveLength(0);
    expect(state().data.activities[0]?.phaseId).toBeNull();
    expect(state().planning.history.past[0]?.inverse).toEqual({
      operation: 'planning.restoreGroup',
      restorationGroupId: 'phase-delete-group',
    });

    const phase = requireValue(initial.phases[0], 'phase fixture');
    const activityForRestore = requireValue(
      state().data.activities[0],
      'activity after phase delete',
    );
    respondWithPatch(
      transport,
      {
        removed: [],
        upserts: [
          { entity: 'phases', row: phase },
          { entity: 'activities', row: { ...activityForRestore, phaseId: phase.id } },
        ],
      },
      { consumedGroupId: 'phase-delete-group' },
    );
    await controller.undo();

    expect(transport.calls.at(-1)).toEqual({
      operation: 'planning.restoreGroup',
      restorationGroupId: 'phase-delete-group',
    });
    expect(state().data.phases).toMatchObject([{ id: 'phase-1' }]);
    expect(state().data.activities[0]?.phaseId).toBe('phase-1');
  });

  it('uses archive and unarchive intents for resource creation history without changing its id', async () => {
    const initial = makeAppData({ accounts: [makeAccount({ id: companyId })] });
    const { controller, state, transport } = flow(initial);
    await controller.refresh();
    const id = 'resource-1';
    const command = buildResourceCreate({
      data: state().data,
      accountId: companyId,
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
    if (!command) throw new Error('Expected resource command.');
    await controller.execute(controller.begin(null), command.intent, command.inverse);
    await controller.undo();
    expect(state().data.resources[0]?.id).toBe(id);
    expect(state().data.resources[0]?.archivedAt).not.toBeNull();
    await controller.redo();
    expect(state().data.resources).toHaveLength(1);
    expect(state().data.resources[0]?.id).toBe(id);
    expect(state().data.resources[0]?.archivedAt).toBeNull();
    expect(transport.calls.map(({ operation }) => operation)).toEqual([
      'resource.create',
      'resource.archive',
      'resource.unarchive',
    ]);
  });

  it('honors the server history directive after a privacy change', async () => {
    const client = makeClient({
      id: 'client-1',
      accountId: companyId,
      name: 'Wayne Enterprises',
    });
    const initial = makeAppData({
      accounts: [makeAccount({ id: companyId })],
      clients: [client],
    });
    const { controller, state, transport } = flow(initial);
    await controller.refresh();
    const next = { ...client, isPrivate: true, codeName: 'Project Bat' };
    transport.respondNext(
      (execution) => ({
        status: 'committed',
        mutationId: execution.mutationId,
        revision: execution.baseRevision + 1,
        restoration: { consumedGroupId: null, replacementGroupId: null },
        projection: { mode: 'refetch', history: 'clear' },
      }),
      { ...initial, clients: [next] },
    );

    await controller.execute(
      controller.begin(null),
      {
        operation: 'catalogue.update',
        entity: {
          entity: 'clients',
          id: client.id,
          changes: { isPrivate: true, codeName: 'Project Bat' },
        },
      },
      null,
    );

    expect(state().data.clients[0]).toMatchObject({ isPrivate: true, codeName: 'Project Bat' });
    expect(state().planning.history.past).toHaveLength(0);
  });

  it('keeps a failed draft out of canonical rows while recording its sent intent', async () => {
    const client = makeClient({ id: 'client-1', accountId: companyId });
    const initial = makeAppData({
      accounts: [makeAccount({ id: companyId })],
      clients: [client],
    });
    const { controller, state, transport } = flow(initial);
    await controller.refresh();
    transport.failNext(new Error('server refusal'));

    await expect(
      controller.execute(
        controller.begin(client),
        {
          operation: 'catalogue.update',
          entity: { entity: 'clients', id: client.id, changes: { name: 'Wayne Studio' } },
        },
        null,
      ),
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
