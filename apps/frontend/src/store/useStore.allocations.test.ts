import { requireCreated } from '@/test/requireCreated';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Allocation } from '@capacitylens/shared/types/entities';
import {
  DEFAULT_COMPANY_ID,
  makeActivity,
  makeResource,
  makeResourceDraft,
  requireValue,
  resetStoreWithAccount,
  WORKDAYS,
} from '@/test/fixtures';
import { useStore } from './useStore';
import type { Draft } from './useStore';
import { getStubPlanningTransport } from '@/test/planningTransportHandle';
import {
  queueAllocationDeleteGroupResponse,
  queueAllocationGroupResponse,
} from '@/test/planning/queuePlanningFixtures';
import { queuePlanningPatch } from '@/test/planning/queuePlanningPatch';
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { grantFor } from '@/test/permissionGrants';

const state = () => useStore.getState();
const typedHistory = () => state().planning.history;

beforeEach(() => resetStoreWithAccount());

async function allocationSetup() {
  const resource = await requireCreated(state().addResource(makeResourceDraft()));
  const activity = await requireCreated(state().addActivity({ name: 'Admin', kind: 'repeatable' }));
  const draft = (overrides: Partial<Draft<Allocation>> = {}): Draft<Allocation> => ({
    resourceId: resource.id,
    activityId: activity.id,
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    hoursPerDay: 8,
    status: 'confirmed',
    ...overrides,
  });
  return { resource, activity, draft };
}

/** A weekly repeat whose last start is `until`. */
const weekly = (until: string) => ({
  pattern: { kind: 'weeks' as const, interval: 1 as const },
  until,
});

const twoWeeklyDates = [
  ['2026-06-01', '2026-06-03'],
  ['2026-06-08', '2026-06-10'],
] as const;
const threeWeeklyDates = [...twoWeeklyDates, ['2026-06-15', '2026-06-17']] as const;

describe('atomic allocation creation', () => {
  it('shares the single/repeat path, mints unique rows, preserves valid hours and records one typed history step', async () => {
    const { draft } = await allocationSetup();
    queueAllocationGroupResponse(twoWeeklyDates);
    const created = requireCreated(
      await state().addRepeatedAllocation(draft({ hoursPerDay: 24 }), weekly('2026-06-08'), 2),
    );

    const sent = getStubPlanningTransport().calls.at(-1);
    expect(sent).toMatchObject({
      operation: 'allocation.createGroup',
      allocation: { id: created[0]?.id, startDate: '2026-06-01' },
      repeat: weekly('2026-06-08'),
      occurrenceIds: [created[1]?.id],
    });
    expect(sent).not.toHaveProperty('allocations');
    expect(created).toHaveLength(2);
    expect(new Set(created.map((allocation) => allocation.id)).size).toBe(2);
    expect(created.every((allocation) => allocation.companyId === DEFAULT_COMPANY_ID)).toBe(true);
    expect(requireValue(created[0], 'first allocation').hoursPerDay).toBe(24);
    expect(state().data.allocations).toEqual(created);
    expect(typedHistory().canUndo).toBe(true);

    const single = requireCreated(
      await state().addAllocation(draft({ startDate: '2026-06-15', endDate: '2026-06-15' })),
    );
    expect(state().data.allocations.at(-1)).toEqual(single);
    expect(typedHistory().canUndo).toBe(true);
  });
  it('applies the monthly end dates returned for a three-day working week', async () => {
    const { resource, draft } = await allocationSetup();
    await state().updateAccount(DEFAULT_COMPANY_ID, {
      schedulingMode: 'days',
      workingDays: WORKDAYS,
    });
    await state().updateResource(resource.id, { workingDays: [1, 2, 3] });
    const repeat = { pattern: { kind: 'monthly-date' as const }, until: '2026-08-01' };
    queueAllocationGroupResponse([
      ['2026-06-01', '2026-06-03'],
      ['2026-07-01', '2026-07-07'],
      ['2026-08-01', '2026-08-05'],
    ]);
    const created = requireCreated(await state().addRepeatedAllocation(draft(), repeat, 3));
    expect(getStubPlanningTransport().calls.at(-1)).toMatchObject({
      operation: 'allocation.createGroup',
      allocation: { resourceId: resource.id, startDate: '2026-06-01', endDate: '2026-06-03' },
      repeat,
      occurrenceIds: [created[1]?.id, created[2]?.id],
    });
    expect(state().data.allocations.find((row) => row.startDate === '2026-07-01')?.endDate).toBe(
      '2026-07-07',
    );
  });

  it('rejects a repeat of fewer than two occurrences', async () => {
    const { draft } = await allocationSetup();
    await expect(state().addRepeatedAllocation(draft(), weekly('2026-06-08'), 1)).rejects.toThrow(
      /at least two occurrences/i,
    );
    expect(state().data.allocations).toHaveLength(0);
  });

  it('rejects an invalid first occurrence before any state/history publication', async () => {
    const { draft } = await allocationSetup();
    const historyBefore = typedHistory();
    let publications = 0;
    const unsubscribe = useStore.subscribe(() => {
      publications += 1;
    });
    await expect(
      state().addRepeatedAllocation(
        draft({ startDate: '2026-07-10', endDate: '2026-07-01' }),
        weekly('2026-07-24'),
        3,
      ),
    ).rejects.toThrow(/end date cannot be before/i);
    unsubscribe();
    expect(publications).toBe(0);
    expect(state().data.allocations).toHaveLength(0);
    expect(typedHistory()).toEqual(historyBefore);
  });
  it('rejects foreign references and a placeholder/project mismatch atomically', async () => {
    const first = await allocationSetup();
    const otherResource = makeResource({ id: 'other-resource', companyId: 'other-company' });
    const otherActivity = makeActivity({
      id: 'other-activity',
      companyId: 'other-company',
      kind: 'repeatable',
      projectId: null,
    });
    useStore.setState((current) => ({
      data: {
        ...current.data,
        resources: [...current.data.resources, otherResource],
        activities: [...current.data.activities, otherActivity],
      },
    }));
    const historyBeforeCrossAccountRejection = typedHistory();
    await expect(
      state().addRepeatedAllocation(
        first.draft({ resourceId: otherResource.id, activityId: otherActivity.id }),
        weekly('2026-06-08'),
        2,
      ),
    ).rejects.toThrow(/active company|existing resource and activity/i);
    expect(state().data.allocations).toHaveLength(0);
    expect(typedHistory()).toEqual(historyBeforeCrossAccountRejection);

    const client = await requireCreated(state().addClient({ name: 'Client', color: '#111111' }));
    const boundProject = await requireCreated(
      state().addProject({ name: 'Bound', clientId: client.id, color: '#222222' }),
    );
    const otherProject = await requireCreated(
      state().addProject({ name: 'Other', clientId: client.id, color: '#333333' }),
    );
    const placeholder = await requireCreated(
      state().addResource({
        kind: 'placeholder',
        role: 'Designer',
        employmentType: 'permanent',
        engagement: 'studio' as const,
        workingHoursPerDay: 8,
        workingDays: WORKDAYS,
        halfDays: [],
        color: '#444444',
        projectId: boundProject.id,
      }),
    );
    const mismatchedActivity = await requireCreated(
      state().addActivity({
        name: 'Wrong project',
        kind: 'project',
        projectId: otherProject.id,
      }),
    );
    const historyBeforePlaceholderRejection = typedHistory();
    await expect(
      state().addRepeatedAllocation(
        first.draft({ resourceId: placeholder.id, activityId: mismatchedActivity.id }),
        weekly('2026-06-08'),
        2,
      ),
    ).rejects.toThrow(/placeholder.*bound project/i);
    expect(state().data.allocations).toHaveLength(0);
    expect(typedHistory()).toEqual(historyBeforePlaceholderRejection);
  });
  it('creates one typed Undo/Redo unit for the complete batch', async () => {
    const { draft } = await allocationSetup();
    queueAllocationGroupResponse(threeWeeklyDates);
    const created = requireCreated(
      await state().addRepeatedAllocation(draft(), weekly('2026-06-15'), 3),
    );
    expect(state().data.allocations).toEqual(created);
    expect(await state().undoPlanning()).toBe(true);
    expect(getStubPlanningTransport().historySteps).toEqual(['undo']);
    expect(state().data.allocations).toHaveLength(0);
    expect(await state().redoPlanning()).toBe(true);
    expect(getStubPlanningTransport().historySteps).toEqual(['undo', 'redo']);
    expect(state().data.allocations.map(({ id }) => id)).toEqual(created.map(({ id }) => id));
  });

  it('links a repeated set under one series and isolates a single-occurrence edit', async () => {
    const { draft } = await allocationSetup();
    queueAllocationGroupResponse(twoWeeklyDates, 'server-series');
    const created = requireCreated(
      await state().addRepeatedAllocation(draft(), weekly('2026-06-08'), 2),
    );

    expect(created[0]?.seriesId).toBeTruthy();
    expect(created[1]?.seriesId).toBe(created[0]?.seriesId);
    const first = requireValue(created[0], 'first repeated allocation');
    expect(await state().updateAllocation(first.id, { note: 'Only this week' })).toEqual({});
    expect(
      state().data.allocations.find((allocation) => allocation.id === first.id),
    ).toHaveProperty('note', 'Only this week');
    const second = requireValue(created[1], 'second repeated allocation');
    expect(
      state().data.allocations.find((allocation) => allocation.id === second.id)?.note,
    ).toBeNull();
  });

  it('applies the Viewer guard to the whole batch', async () => {
    const { draft } = await allocationSetup();
    const historyBefore = typedHistory();
    state().setActiveRole('viewer', 'resolved', grantFor('viewer').permissions);
    const returned = await state().addRepeatedAllocation(draft(), weekly('2026-06-08'), 2);
    expect(returned).toEqual({ kind: 'blocked' });
    expect(state().data.allocations).toHaveLength(0);
    expect(typedHistory()).toEqual(historyBefore);
    expect(state().notice).toMatchObject({ tone: 'error' });
  });
});

describe('allocation save advisory', () => {
  it('passes the save reply advisory through every allocation write', async () => {
    const { draft } = await allocationSetup();
    const advisory = { overDays: 3, timeOffDays: 1 };
    const createdAt = new Date().toISOString();
    queuePlanningPatch(
      (execution) => {
        if (execution.intent.operation !== 'allocation.create') {
          throw new Error('Expected a create.');
        }
        const row = {
          ...NULLABLE_FIELDS.allocations,
          ...execution.intent.allocation,
          companyId: DEFAULT_COMPANY_ID,
          createdAt,
          updatedAt: createdAt,
        } as Allocation;
        return { removed: [], upserts: [{ entity: 'allocations', row }] };
      },
      { advisory },
    );
    const created = await state().addAllocation(draft());
    expect(created).toMatchObject({ kind: 'created', advisory });
    const allocation = requireCreated(created);
    queuePlanningPatch(
      () => ({
        removed: [],
        upserts: [{ entity: 'allocations', row: { ...allocation, hoursPerDay: 6 } }],
      }),
      { advisory },
    );
    expect(await state().updateAllocation(allocation.id, { hoursPerDay: 6 })).toEqual({ advisory });

    const repeatAdvisory = {
      overCapacityAllocations: 1,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 1,
    };
    queueAllocationGroupResponse(
      [
        ['2026-06-15', '2026-06-15'],
        ['2026-06-22', '2026-06-22'],
      ],
      null,
      repeatAdvisory,
    );
    expect(
      await state().addRepeatedAllocation(
        draft({ startDate: '2026-06-15', endDate: '2026-06-15' }),
        weekly('2026-06-22'),
        2,
      ),
    ).toMatchObject({ kind: 'created', repeatAdvisory });
  });
});

describe('resource availability boundaries', () => {
  it('rejects a repeat whose first occurrence starts before availability', async () => {
    const { resource, draft } = await allocationSetup();
    await state().updateResource(resource.id, {
      firstAvailableDate: '2026-06-08',
      lastAvailableDate: '2026-06-30',
    });
    const historyBefore = typedHistory();

    await expect(state().addRepeatedAllocation(draft(), weekly('2026-06-08'), 2)).rejects.toThrow(
      /before.*available/i,
    );
    expect(state().data.allocations).toHaveLength(0);
    expect(typedHistory()).toEqual(historyBefore);
  });

  it('checks normal spans on scheduled working days while ignore working days checks every day', async () => {
    const { resource, draft } = await allocationSetup();
    await state().updateResource(resource.id, {
      workingDays: [2, 3, 4, 5],
      firstAvailableDate: '2026-06-02',
    });

    await expect(
      state().addAllocation(draft({ startDate: '2026-06-01', endDate: '2026-06-02' })),
    ).resolves.toMatchObject({ kind: 'created' });
    await expect(
      state().addAllocation(
        draft({ startDate: '2026-06-01', endDate: '2026-06-02', ignoreWorkingDays: true }),
      ),
    ).rejects.toThrow(/before.*available/i);
  });

  it('uses the company and person working-day intersection for boundary checks', async () => {
    const { resource, draft } = await allocationSetup();
    await state().updateAccount(DEFAULT_COMPANY_ID, { workingDays: [1, 2, 3, 4] });
    await state().updateResource(resource.id, {
      workingDays: [1, 2, 3, 4, 5],
      lastAvailableDate: '2026-06-04',
    });

    await expect(
      state().addAllocation(draft({ startDate: '2026-06-04', endDate: '2026-06-05' })),
    ).resolves.toMatchObject({ kind: 'created' });
    await expect(
      state().addAllocation(
        draft({ startDate: '2026-06-04', endDate: '2026-06-05', ignoreWorkingDays: true }),
      ),
    ).rejects.toThrow(/after.*available/i);
  });
  it('retains conflicts after boundary changes and allows metadata-only edits', async () => {
    const { resource, draft } = await allocationSetup();
    const allocation = requireCreated(await state().addAllocation(draft()));

    await state().updateResource(resource.id, { firstAvailableDate: '2026-06-08' });
    expect(state().data.allocations).toContainEqual(allocation);
    await expect(
      state().updateAllocation(allocation.id, { note: 'Retained conflict' }),
    ).resolves.toEqual({});
    await expect(
      state().updateAllocation(allocation.id, {
        resourceId: allocation.resourceId,
        startDate: allocation.startDate,
        endDate: allocation.endDate,
        ignoreWorkingDays: allocation.ignoreWorkingDays,
        status: 'tentative',
        task: 'Prepare retained work',
      }),
    ).resolves.toEqual({});
    await expect(
      state().updateAllocation(allocation.id, { endDate: '2026-06-04' }),
    ).rejects.toThrow(/before.*available/i);
    expect(state().data.allocations.find(({ id }) => id === allocation.id)).toMatchObject({
      note: 'Retained conflict',
      task: 'Prepare retained work',
      status: 'tentative',
    });
  });

  it('rejects moving an allocation after the last date and reassigning into a bounded person', async () => {
    const { resource, draft } = await allocationSetup();
    const bounded = await requireCreated(
      state().addResource(
        makeResourceDraft({
          name: 'Victor Stone',
          firstAvailableDate: '2026-06-01',
          lastAvailableDate: '2026-06-03',
        }),
      ),
    );
    const allocation = requireCreated(
      await state().addAllocation(draft({ resourceId: bounded.id })),
    );

    await expect(
      state().updateAllocation(allocation.id, { startDate: '2026-06-08', endDate: '2026-06-08' }),
    ).rejects.toThrow(/after.*available/i);
    await expect(
      state().updateAllocation(allocation.id, { resourceId: resource.id }),
    ).resolves.toEqual({});
    await state().updateResource(bounded.id, {
      firstAvailableDate: '2026-07-01',
      lastAvailableDate: null,
    });
    await expect(
      state().updateAllocation(allocation.id, { resourceId: bounded.id }),
    ).rejects.toThrow(/before.*available/i);
  });
});

describe('repeat-series allocation mutations', () => {
  it('deletes the selected and future occurrences as one typed Undo step', async () => {
    const { draft } = await allocationSetup();
    queueAllocationGroupResponse(threeWeeklyDates, 'server-series');
    const [earlier, selected, later] = requireCreated(
      await state().addRepeatedAllocation(draft(), weekly('2026-06-15'), 3),
    );
    const unrelated = requireCreated(
      await state().addAllocation(draft({ startDate: '2026-06-22', endDate: '2026-06-24' })),
    );
    if (!earlier || !selected || !later) throw new Error('Expected three repeated allocations');

    queueAllocationDeleteGroupResponse([selected.id, later.id], 'group-delete-series');
    await state().deleteAllocationSeriesFrom(selected.id);

    expect(state().data.allocations.map(({ id }) => id)).toEqual([earlier.id, unrelated.id]);
    expect(typedHistory().canUndo).toBe(true);
    expect(await state().undoPlanning()).toBe(true);
    expect(state().data.allocations).toHaveLength(4);
    expect(await state().redoPlanning()).toBe(true);
    expect(state().data.allocations.map(({ id }) => id)).not.toContain(selected.id);
    expect(state().data.allocations.map(({ id }) => id)).not.toContain(later.id);
  });

  it('keeps series membership system-owned while editing linked and one-off allocations', async () => {
    const { draft } = await allocationSetup();
    queueAllocationGroupResponse(twoWeeklyDates, 'server-series');
    const [linked] = requireCreated(
      await state().addRepeatedAllocation(draft(), weekly('2026-06-08'), 2),
    );
    const oneOff = requireCreated(
      await state().addAllocation(draft({ startDate: '2026-07-01', endDate: '2026-07-01' })),
    );
    if (!linked) throw new Error('Expected a linked allocation');

    await state().updateAllocation(linked.id, { note: 'Retained', seriesId: 'other-series' });
    await state().updateAllocation(oneOff.id, {
      note: 'Still one-off',
      seriesId: 'invented-series',
    });

    expect(state().data.allocations.find(({ id }) => id === linked.id)).toMatchObject({
      note: 'Retained',
      seriesId: linked.seriesId,
    });
    const updatedOneOff = state().data.allocations.find(({ id }) => id === oneOff.id);
    expect(updatedOneOff).toMatchObject({ note: 'Still one-off' });
    expect(updatedOneOff).toHaveProperty('seriesId', null);
  });

  it('rejects a series-tail operation for an unlinked allocation without publishing history', async () => {
    const { draft } = await allocationSetup();
    const oneOff = requireCreated(await state().addAllocation(draft()));
    const pastBefore = typedHistory();

    await expect(state().deleteAllocationSeriesFrom(oneOff.id)).rejects.toThrow(
      /not part of a repeat series/i,
    );
    expect(state().data.allocations).toContainEqual(oneOff);
    expect(typedHistory()).toEqual(pastBefore);
  });
});

describe('updateAllocation input validation', () => {
  it('rejects an over-day hours patch without changing the allocation', async () => {
    const { draft } = await allocationSetup();
    const allocation = requireCreated(await state().addAllocation(draft({})));

    await expect(state().updateAllocation(allocation.id, { hoursPerDay: 99 })).rejects.toThrow();

    expect(state().data.allocations.find(({ id }) => id === allocation.id)).toMatchObject({
      hoursPerDay: 8,
    });
    expect(state().notice).toBeNull();
  });

  it('still rejects a non-zero-hours write onto an external resource with valid supplied hours', async () => {
    const { draft } = await allocationSetup();
    const allocation = requireCreated(await state().addAllocation(draft({})));

    useStore.setState((s) => ({
      data: {
        ...s.data,
        resources: s.data.resources.map((r) =>
          r.id === allocation.resourceId ? { ...r, kind: 'external' as const } : r,
        ),
      },
    }));

    await expect(state().updateAllocation(allocation.id, { hoursPerDay: 8 })).rejects.toThrow(
      /external/,
    );

    const row = state().data.allocations.find(({ id }) => id === allocation.id);
    expect(row?.hoursPerDay).not.toBe(0);
  });
});

it.each([-1, 24.01, Number.NaN, Infinity])(
  'rejects raw invalid allocation hours %s before a write',
  async (hoursPerDay) => {
    const { draft } = await allocationSetup();
    const before = state().planning;
    await expect(state().addAllocation(draft({ hoursPerDay }))).rejects.toThrow();
    expect(state().data.allocations).toHaveLength(0);
    expect(state().planning).toBe(before);
  },
);

it.each([0, 0.5, 24])(
  'preserves valid raw allocation hours %s on create and update',
  async (hoursPerDay) => {
    const { draft } = await allocationSetup();
    const allocation = requireCreated(await state().addAllocation(draft({ hoursPerDay })));
    expect(allocation.hoursPerDay).toBe(hoursPerDay);
    await state().updateAllocation(allocation.id, { hoursPerDay });
    expect(state().data.allocations.find((row) => row.id === allocation.id)?.hoursPerDay).toBe(
      hoursPerDay,
    );
  },
);
