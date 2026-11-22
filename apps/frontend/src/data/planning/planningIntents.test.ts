import { describe, expect, it } from 'vitest';
import {
  makeCompany,
  makeActivity,
  makeAllocation,
  makeAppData,
  makeClient,
  makeClosure,
  makeProject,
  makeResource,
  makeTimeOff,
} from '@/test/fixtures';
import {
  buildAllocationCreate,
  buildAllocationDuplicate,
  buildAllocationUpdate,
  buildCatalogueCreate,
  buildCatalogueUpdate,
  buildClosureCreate,
  buildClosureUpdate,
  buildResourceCreate,
  buildResourceUpdate,
  buildSettingsUpdate,
  buildTimeOffCreate,
  buildTimeOffUpdate,
} from './planningIntents';

const companyId = 'acct-test';
const stableId = '7415a19e-539d-45c9-9c52-8b8c3a058926';

describe('planning intent builders', () => {
  it('uses one stable supplied ID and explicit nullable defaults for allocation creates', () => {
    const data = makeAppData({
      resources: [makeResource({ id: 'resource-1', companyId })],
      activities: [
        makeActivity({ id: 'activity-1', companyId, kind: 'repeatable', projectId: null }),
      ],
    });

    const intentRequest = buildAllocationCreate({
      data,
      companyId,
      args: {
        id: stableId,
        fields: {
          resourceId: 'resource-1',
          activityId: 'activity-1',
          startDate: '2026-10-26',
          endDate: '2026-10-30',
          hoursPerDay: 8,
          status: 'confirmed',
        },
      },
    });

    expect(intentRequest).toEqual({
      intent: {
        operation: 'allocation.create',
        allocation: {
          id: stableId,
          resourceId: 'resource-1',
          activityId: 'activity-1',
          projectId: null,
          startDate: '2026-10-26',
          endDate: '2026-10-30',
          hoursPerDay: 8,
          status: 'confirmed',
          note: null,
          task: null,
          ignoreWorkingDays: null,
        },
      },
    });
  });

  it('duplicates an unchanged source by ID and creates an explicitly edited copy', () => {
    const original = makeAllocation({
      id: 'source',
      companyId,
      resourceId: 'resource',
      activityId: 'activity',
      projectId: null,
      note: null,
      task: null,
      ignoreWorkingDays: null,
    });
    const data = makeAppData({
      activities: [makeActivity({ id: 'activity', companyId, kind: 'internal', projectId: null })],
      allocations: [original],
    });
    const fields = {
      ...original,
      startDate: '2026-11-02',
      endDate: '2026-11-06',
      ignoreWorkingDays: false,
    };
    const copy = buildAllocationDuplicate({
      data,
      companyId,
      original,
      args: { sourceId: original.id, id: stableId, fields },
    });
    expect(copy?.intent).toEqual({
      operation: 'allocation.duplicate',
      sourceAllocationId: original.id,
      occurrence: { id: stableId, startDate: fields.startDate, endDate: fields.endDate },
    });
    const edited = buildAllocationDuplicate({
      data,
      companyId,
      original,
      args: {
        sourceId: original.id,
        id: stableId,
        fields: { ...fields, note: 'Deliberate copy edit' },
      },
    });
    expect(edited?.intent).toMatchObject({
      operation: 'allocation.create',
      allocation: { id: stableId, note: 'Deliberate copy edit' },
    });
  });

  it('sends only changed allocation fields, compared with the draft original', () => {
    const original = makeAllocation({ id: 'allocation-1', companyId, note: 'old', hoursPerDay: 8 });
    const current = { ...original, note: 'server changed' };
    const intentRequest = buildAllocationUpdate({
      data: makeAppData({ allocations: [current] }),
      companyId,
      original,
      args: { id: original.id, changes: { note: undefined, hoursPerDay: 8 } },
    });

    expect(intentRequest).toEqual({
      intent: { operation: 'allocation.update', id: original.id, changes: { note: null } },
    });
  });

  it('treats unchanged updates as no-ops before reaching the server', () => {
    const allocation = makeAllocation({ id: 'allocation-1', companyId });
    expect(
      buildAllocationUpdate({
        data: makeAppData({ allocations: [allocation] }),
        companyId,
        original: allocation,
        args: { id: allocation.id, changes: { status: allocation.status } },
      }),
    ).toBeNull();
  });

  it('sends an activity change the cache cannot resolve, so the server decides', () => {
    const allocation = makeAllocation({ id: 'allocation-1', companyId });
    expect(
      buildAllocationUpdate({
        data: makeAppData({ allocations: [allocation] }),
        companyId,
        original: allocation,
        args: { id: allocation.id, changes: { activityId: 'activity-gone' } },
      }),
    ).toEqual({
      intent: {
        operation: 'allocation.update',
        id: allocation.id,
        changes: { activityId: 'activity-gone' },
      },
    });
  });

  it('keeps a draft change when a refresh has made that value current', () => {
    const original = makeAllocation({ id: 'allocation-1', companyId, note: 'before' });
    const refreshed = { ...original, note: 'after' };
    expect(
      buildAllocationUpdate({
        data: makeAppData({ allocations: [refreshed] }),
        companyId,
        original,
        args: { id: original.id, changes: { note: 'after' } },
      }),
    ).toEqual({
      intent: { operation: 'allocation.update', id: original.id, changes: { note: 'after' } },
    });
  });

  it('omits activity kind when unchanged and normalizes project links when kind changes', () => {
    const activity = makeActivity({ id: 'activity-1', companyId });
    const sameKind = buildCatalogueUpdate({
      data: makeAppData({ activities: [activity] }),
      companyId,
      original: activity,
      args: { entity: 'activities', id: activity.id, changes: { name: 'Revised' } },
    });
    expect(sameKind?.intent).toEqual({
      operation: 'catalogue.update',
      entity: { entity: 'activities', id: activity.id, changes: { name: 'Revised' } },
    });

    const changedKind = buildCatalogueUpdate({
      data: makeAppData({ activities: [activity] }),
      companyId,
      original: activity,
      args: { entity: 'activities', id: activity.id, changes: { kind: 'internal' } },
    });
    expect(changedKind?.intent).toEqual({
      operation: 'catalogue.update',
      entity: {
        entity: 'activities',
        id: activity.id,
        changes: { kind: 'internal', projectId: null },
      },
    });
  });

  it('treats null and false privacy as the same public value for client and project patches', () => {
    const client = makeClient({ id: 'client-1', companyId, isPrivate: null });
    const clientCommand = buildCatalogueUpdate({
      data: makeAppData({ clients: [client] }),
      companyId,
      original: client,
      args: {
        entity: 'clients',
        id: client.id,
        changes: { name: 'Updated client', isPrivate: false },
      },
    });
    expect(clientCommand).toEqual({
      intent: {
        operation: 'catalogue.update',
        entity: { entity: 'clients', id: client.id, changes: { name: 'Updated client' } },
      },
    });

    const project = makeProject({ id: 'project-1', companyId, isPrivate: null });
    const projectCommand = buildCatalogueUpdate({
      data: makeAppData({ projects: [project] }),
      companyId,
      original: project,
      args: {
        entity: 'projects',
        id: project.id,
        changes: { name: 'Updated project', isPrivate: false },
      },
    });
    expect(projectCommand).toEqual({
      intent: {
        operation: 'catalogue.update',
        entity: { entity: 'projects', id: project.id, changes: { name: 'Updated project' } },
      },
    });
  });

  it.each([
    { original: null, requested: true },
    { original: true, requested: false },
    { original: true, requested: null },
    { original: false, requested: true },
  ])(
    'preserves real client privacy changes from $original to $requested',
    ({ original, requested }) => {
      const client = makeClient({ id: 'client-1', companyId, isPrivate: original });
      const intentRequest = buildCatalogueUpdate({
        data: makeAppData({ clients: [client] }),
        companyId,
        original: client,
        args: { entity: 'clients', id: client.id, changes: { isPrivate: requested } },
      });

      expect(intentRequest?.intent).toEqual({
        operation: 'catalogue.update',
        entity: { entity: 'clients', id: client.id, changes: { isPrivate: requested } },
      });
    },
  );

  it('normalizes create drafts and reports created IDs for resources and time off', () => {
    const data = makeAppData({
      companies: [makeCompany({ id: companyId })],
      resources: [makeResource({ id: 'resource-1', companyId })],
    });
    const resource = buildResourceCreate({
      data,
      companyId,
      args: {
        id: stableId,
        fields: {
          kind: 'placeholder',
          name: null,
          role: 'Designer',
          employmentType: 'permanent',
          workingHoursPerDay: 8,
          workingDays: [1, 2, 3, 4, 5],
          halfDays: [],
          projectId: 'project-1',
          color: '#2d75da',
        },
      },
    });
    expect(resource?.intent).toMatchObject({
      operation: 'resource.create',
      id: stableId,
      fields: { engagement: 'studio', workingDays: [1, 2, 3, 4, 5], halfDays: [] },
    });

    const timeOff = buildTimeOffCreate({
      data,
      companyId,
      args: {
        id: stableId,
        fields: {
          resourceId: 'resource-1',
          startDate: '2026-10-26',
          endDate: '2026-10-30',
          type: 'holiday',
        },
      },
    });
    expect(timeOff).toEqual({
      intent: {
        operation: 'timeOff.create',
        timeOff: {
          id: stableId,
          resourceId: 'resource-1',
          startDate: '2026-10-26',
          endDate: '2026-10-30',
          type: 'holiday',
        },
      },
    });
  });

  it('omits an unsupplied time-off note but preserves an explicit note or clear', () => {
    const data = makeAppData({ resources: [makeResource({ id: 'resource-1', companyId })] });
    for (const note of ['Private note', null] as const) {
      const intentRequest = buildTimeOffCreate({
        data,
        companyId,
        args: {
          id: stableId,
          fields: {
            resourceId: 'resource-1',
            startDate: '2026-10-26',
            endDate: '2026-10-30',
            type: 'holiday',
            note,
          },
        },
      });
      expect(intentRequest?.intent).toMatchObject({
        operation: 'timeOff.create',
        timeOff: { note },
      });
    }
  });

  it('builds explicit time-off and resource updates against the draft', () => {
    const timeOff = makeTimeOff({ id: 'time-off-1', companyId, note: 'old note' });
    expect(
      buildTimeOffUpdate({
        data: makeAppData({ timeOff: [timeOff] }),
        companyId,
        original: timeOff,
        args: { id: timeOff.id, changes: { note: undefined, type: 'sick' } },
      }),
    ).toEqual({
      intent: {
        operation: 'timeOff.update',
        id: timeOff.id,
        changes: { type: 'sick', note: null },
      },
    });

    const resource = makeResource({ id: 'resource-1', companyId, role: 'Designer' });
    expect(
      buildResourceUpdate({
        data: makeAppData({ resources: [resource] }),
        companyId,
        original: resource,
        args: { id: resource.id, changes: { role: 'Lead designer' } },
      }),
    ).toEqual({
      intent: { operation: 'resource.update', id: resource.id, changes: { role: 'Lead designer' } },
    });
  });

  it('preserves supplied activity fields for authoritative validation and creates closures by id', () => {
    const data = makeAppData({ companies: [makeCompany({ id: companyId })] });
    expect(
      buildCatalogueCreate({
        data,
        companyId,
        args: {
          entity: 'activities',
          id: stableId,
          fields: {
            name: 'Internal planning',
            kind: 'internal',
            projectId: 'stale',
            phaseId: 'stale',
          },
        },
      }),
    ).toEqual({
      intent: {
        operation: 'catalogue.create',
        entity: {
          entity: 'activities',
          id: stableId,
          fields: {
            name: 'Internal planning',
            kind: 'internal',
            projectId: 'stale',
            phaseId: 'stale',
          },
        },
      },
    });

    const closure = buildClosureCreate({
      data,
      companyId,
      args: {
        id: stableId,
        fields: { name: 'Office closed', startDate: '2026-12-24', endDate: '2026-12-27' },
      },
    });
    expect(closure?.intent).toMatchObject({ operation: 'closure.create', id: stableId });
  });

  it('sends only the changed closure and company settings fields', () => {
    const closure = makeClosure({ id: 'closure-1', companyId });
    const changed = buildClosureUpdate({
      data: makeAppData({ closures: [closure] }),
      companyId,
      original: closure,
      args: { id: closure.id, changes: { name: 'New shutdown' } },
    });
    expect(changed).toEqual({
      intent: { operation: 'closure.update', id: closure.id, changes: { name: 'New shutdown' } },
    });

    const company = makeCompany({ id: companyId, name: 'Before' });
    const settings = buildSettingsUpdate({
      data: makeAppData({ companies: [company] }),
      companyId,
      original: company,
      args: { name: 'After' },
    });
    expect(settings).toEqual({
      intent: { operation: 'settings.update', changes: { name: 'After' } },
    });

    const nullableSetting = makeCompany({ id: companyId, timezone: 'Etc/GMT' });
    expect(
      buildSettingsUpdate({
        data: makeAppData({ companies: [nullableSetting] }),
        companyId,
        original: nullableSetting,
        args: { timezone: undefined },
      })?.intent,
    ).toEqual({ operation: 'settings.update', changes: { timezone: null } });
  });
});
