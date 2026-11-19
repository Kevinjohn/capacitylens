import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from './useStore';
import {
  DEFAULT_COMPANY_ID,
  makeAppData,
  makeResource,
  requireValue,
  resetStoreWithCompany,
  resetStoreWithData,
} from '@/test/fixtures';
import { getPlanningTransportHandle } from '@/test/planningTransportHandle';
import { queuePlanningPatch } from '@/test/planning/queuePlanningPatch';

const T = '2026-01-01T00:00:00.000Z';
const meta = { companyId: DEFAULT_COMPANY_ID, createdAt: T, updatedAt: T };

beforeEach(() => resetStoreWithCompany());
afterEach(() => {
  vi.restoreAllMocks();
});

describe('typed undo restores cascade bindings', () => {
  it('uses the row timestamp read after undo for the next edit', async () => {
    const original = {
      ...NULLABLE_FIELDS.clients,
      ...meta,
      id: 'c1',
      name: 'Client',
      color: '#111111',
    };
    const saved = { ...original, name: 'Changed', updatedAt: '2026-02-01T09:00:00.000Z' };
    const restoredAt = '2026-02-01T09:00:00.001Z';
    await resetStoreWithData(makeAppData({ clients: [original] }), DEFAULT_COMPANY_ID);
    queuePlanningPatch(() => ({ upserts: [{ entity: 'clients', row: saved }], removed: [] }));
    await useStore.getState().updateClient(original.id, { name: saved.name });
    expect(useStore.getState().data.clients[0]?.updatedAt).toBe(saved.updatedAt);

    const transport = getPlanningTransportHandle();
    const read = transport.read;
    vi.spyOn(transport, 'read').mockImplementationOnce(async (...args) => {
      const snapshot = await read(...args);
      return {
        ...snapshot,
        data: { ...snapshot.data, clients: [{ ...original, updatedAt: restoredAt }] },
      };
    });
    await expect(useStore.getState().undoPlanning()).resolves.toBe(true);
    const row = requireValue(useStore.getState().data.clients[0], 'restored client');
    expect(row).toMatchObject({ name: original.name, updatedAt: restoredAt });

    const send = vi.spyOn(transport, 'execute');
    await useStore.getState().updateClient(row.id, { name: 'Next edit' }, row.updatedAt);
    expect(send.mock.calls[0]?.[1]).toMatchObject({ expectedUpdatedAt: restoredAt });
  });

  it('undoes a creation in a large tenant without losing its existing rows', async () => {
    const clients = Array.from({ length: 75_000 }, (_, index) => ({
      ...NULLABLE_FIELDS.clients,
      ...meta,
      id: `client-${index}`,
      name: `Client ${index}`,
      color: '#111111',
    }));
    await resetStoreWithData(makeAppData({ clients }), DEFAULT_COMPANY_ID);
    await useStore.getState().addClient({ name: 'Last client', color: '#222222' });
    const addedClient = requireValue(useStore.getState().data.clients.at(-1), 'last client');

    await expect(useStore.getState().undoPlanning()).resolves.toBe(true);
    const clientsAfterUndo = useStore.getState().data.clients;
    expect(clientsAfterUndo.filter((client) => !client.archivedAt)).toHaveLength(75_000);
    expect(
      clientsAfterUndo.some((client) => client.id === addedClient.id && !client.archivedAt),
    ).toBe(false);
  });
  it('restores an activity phaseId after a phase delete', async () => {
    await resetStoreWithData(
      makeAppData({
        clients: [
          { ...NULLABLE_FIELDS.clients, ...meta, id: 'c1', name: 'Client', color: '#111111' },
        ],
        projects: [
          {
            ...NULLABLE_FIELDS.projects,
            ...meta,
            id: 'p1',
            clientId: 'c1',
            name: 'Project',
            color: '#222222',
          },
        ],
        phases: [{ ...meta, id: 'ph1', projectId: 'p1', name: 'Phase' }],
        activities: [
          {
            ...NULLABLE_FIELDS.activities,
            ...meta,
            id: 'act1',
            projectId: 'p1',
            phaseId: 'ph1',
            kind: 'project',
            name: 'Work',
          },
        ],
      }),
      DEFAULT_COMPANY_ID,
    );
    const deletedActivity = requireValue(useStore.getState().data.activities[0], 'activity');
    const phaseHandle = 'restore-phase-delete';
    queuePlanningPatch(
      (execution) => {
        if (execution.intent.operation !== 'catalogue.delete') {
          throw new Error(`Expected catalogue.delete, received ${execution.intent.operation}.`);
        }
        return {
          removed: [{ entity: 'phases', id: 'ph1' }],
          upserts: [
            {
              entity: 'activities',
              row: { ...deletedActivity, phaseId: null, updatedAt: new Date().toISOString() },
            },
          ],
        };
      },
      { replacementGroupId: phaseHandle },
    );
    await useStore.getState().deletePhase('ph1');
    const afterDelete = useStore.getState().data;
    expect(requireValue(afterDelete.activities[0], 'activity')).toHaveProperty('phaseId', null);
    await expect(useStore.getState().undoPlanning()).resolves.toBe(true);
    expect(useStore.getState().data.phases.map((phase) => phase.id)).toEqual(['ph1']);
    expect(useStore.getState().data.activities[0]?.phaseId).toBe('ph1');
  });

  it('restores a resource disciplineId after a discipline delete', async () => {
    await resetStoreWithData(
      makeAppData({
        disciplines: [
          { ...NULLABLE_FIELDS.disciplines, ...meta, id: 'd1', name: 'Design', sortOrder: 0 },
        ],
        resources: [
          makeResource({ ...meta, id: 'r1', name: 'Person', disciplineId: 'd1', color: '#333333' }),
        ],
      }),
      DEFAULT_COMPANY_ID,
    );
    const deletedResource = requireValue(useStore.getState().data.resources[0], 'resource');
    const disciplineHandle = 'restore-discipline-delete';
    queuePlanningPatch(
      (execution) => {
        if (execution.intent.operation !== 'catalogue.delete') {
          throw new Error(`Expected catalogue.delete, received ${execution.intent.operation}.`);
        }
        return {
          removed: [{ entity: 'disciplines', id: 'd1' }],
          upserts: [
            {
              entity: 'resources',
              row: { ...deletedResource, disciplineId: null, updatedAt: new Date().toISOString() },
            },
          ],
        };
      },
      { replacementGroupId: disciplineHandle },
    );
    await useStore.getState().deleteDiscipline('d1');
    const afterDelete = useStore.getState().data;
    expect(requireValue(afterDelete.resources[0], 'resource')).toHaveProperty('disciplineId', null);
    await expect(useStore.getState().undoPlanning()).resolves.toBe(true);
    expect(useStore.getState().data.disciplines.map((row) => row.id)).toEqual(['d1']);
    expect(useStore.getState().data.resources[0]?.disciplineId).toBe('d1');
  });
});
