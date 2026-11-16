import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { describe, it, expect, vi } from 'vitest';
import { buildSchedulerModel } from './schedulerModel';
import { buildEmptyFilters } from '@/store/useStore';
import { activeOnly } from '@capacitylens/shared/domain/lifecycle';
import type { AppData, Weekday } from '@capacitylens/shared/types/entities';
import { hasRenderableDateRange } from '@/lib/renderableDateRanges';
import { makeAllocation, makeResource, requireValue } from '@/test/fixtures';
import {
  allBars,
  barIds,
  build,
  capacityForWindowOf,
  dataset as buildDataset,
  days,
  end,
  geom,
  makeDisciplines,
  start,
} from './schedulerModel.testSupport';

const dataset = () => buildDataset(makeDisciplines());

function buildCompanyWorkingWeekRow(data: AppData, accountWorkingDays: Weekday[]) {
  return requireValue(
    buildSchedulerModel({
      data,
      geom,
      days,
      visibleWindow: { start, end },
      overSoonWindow: { start, end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
        accountWorkingDays,
      },
    })
      .flatMap((group) => group.rows)
      .find((candidate) => candidate.resource.id === 'r1'),
    'r1 scheduler row',
  );
}

describe('#257 characterization: company-off tint/capacity agreement', () => {
  it('tints a company-closed Friday unavailable with zero available capacity', () => {
    const data = dataset();
    const resource = requireValue(
      data.resources.find((candidate) => candidate.id === 'r1'),
      'r1 resource',
    );
    const row = buildCompanyWorkingWeekRow(data, [1, 2, 3, 4]);
    const fridayCapacity = requireValue(
      capacityForWindowOf({
        resource,
        allocations: data.allocations.filter((allocation) => allocation.resourceId === resource.id),
        timeOff: [],
        windowStart: '2026-06-05',
        windowEnd: '2026-06-05',
        accountWorkingDays: [1, 2, 3, 4],
      })[0],
      'Friday capacity',
    );

    expect(row.dayStates[4]).toMatchObject({ unavailable: true, creationBlocked: true });
    expect(fridayCapacity.available).toBe(0);
  });

  it('marks every visible day creation-blocked for a resource with no effective working week', () => {
    const data = dataset();
    const row = buildCompanyWorkingWeekRow(data, [0]);

    expect(row.dayStates).toHaveLength(days.length);
    expect(row.dayStates.every(({ creationBlocked }) => creationBlocked)).toBe(true);
  });

  it('suppresses a saved Friday half-day tint when Friday is company-closed', () => {
    const data = dataset();
    data.resources = data.resources.map((resource) =>
      resource.id === 'r1' ? { ...resource, halfDays: [5] } : resource,
    );
    const row = buildCompanyWorkingWeekRow(data, [1, 2, 3, 4]);

    expect(row.dayStates[4]).toMatchObject({ unavailable: true, partialCapacity: false });
  });
});

describe('buildSchedulerModel', () => {
  // External rows exclude capacity cues even for zero-availability dates and stray time-off records.
  it('groups by discipline and positions bars (no filters)', () => {
    const model = build();
    expect(model.map((g) => g.title)).toEqual(['Design', 'Development']);
    expect(barIds(model)).toEqual(['a1', 'a2', 'a3']);
    const a1 = requireValue(
      allBars(model).find((b) => b.allocation.id === 'a1'),
      'a1 bar',
    );
    expect(a1.x).toBe(0);

    expect(a1.width).toBe(96);
  });

  it('surfaces the last surviving linked-series end without inferring legacy repeats', () => {
    const data = dataset();
    data.allocations = [
      {
        ...requireValue(data.allocations[0], 'a1 allocation'),
        seriesId: 'series-1',
        endDate: '2026-06-02',
      },
      {
        ...requireValue(data.allocations[0], 'a1 allocation'),
        id: 'series-later',
        seriesId: 'series-1',
        startDate: '2026-08-10',
        endDate: '2026-08-12',
      },
      { ...requireValue(data.allocations[1], 'a2 allocation'), id: 'legacy-repeat' },
    ];
    const model = buildSchedulerModel({
      data,
      geom,
      days,
      visibleWindow: { start, end },
      overSoonWindow: { start, end },
      filters: buildEmptyFilters(),
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });

    expect(allBars(model).find((bar) => bar.allocation.id === 'a1')?.seriesEnd).toBe('2026-08-12');
    const legacyRepeat = allBars(model).find((bar) => bar.allocation.id === 'legacy-repeat');
    expect(legacyRepeat).toBeDefined();
    expect(legacyRepeat).not.toHaveProperty('seriesEnd');
  });

  it('reports and omits corrupt schedule ranges instead of rendering focusable slivers', () => {
    const d = dataset();
    const firstAllocation = d.allocations[0];
    const firstResource = d.resources[0];
    expect(firstAllocation).toBeDefined();
    expect(firstResource).toBeDefined();
    if (!firstAllocation || !firstResource) {
      throw new Error('Expected the base scheduler fixture rows.');
    }
    const corrupt = { ...firstAllocation, startDate: '2026-6-1' };
    d.allocations[0] = corrupt;
    const corruptTimeOff = {
      ...NULLABLE_FIELDS.timeOff,
      id: 'corrupt-time-off',
      accountId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: firstResource.id,
      startDate: '2026-06-03',
      endDate: 'not-a-date',
      type: 'holiday' as const,
    };
    d.timeOff.push(corruptTimeOff);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(hasRenderableDateRange(corrupt)).toBe(false);
      expect(error).not.toHaveBeenCalled();
      const buildCorrupt = () =>
        buildSchedulerModel({
          data: d,
          geom,
          days,
          visibleWindow: { start, end },
          overSoonWindow: { start, end },
          filters: buildEmptyFilters(),
          preferences: {
            disciplinesEnabled: true,
            placeholdersEnabled: true,
            externalEnabled: true,
          },
        });

      const first = buildCorrupt();
      buildCorrupt();

      expect(
        first
          .flatMap((group) => group.rows)
          .flatMap((row) => row.bars.map((bar) => bar.allocation.id)),
      ).not.toContain(corrupt.id);
      expect(
        first.flatMap((group) => group.rows).flatMap((row) => row.timeOff.map((block) => block.id)),
      ).not.toContain(corruptTimeOff.id);
      expect(error).toHaveBeenCalledTimes(2);
      expect(error).toHaveBeenCalledWith(`Scheduler omitted ${corrupt.id}: invalid date range.`);
      expect(error).toHaveBeenCalledWith(
        `Scheduler omitted ${corruptTimeOff.id}: invalid date range.`,
      );
    } finally {
      error.mockRestore();
    }
  });

  it('leaves day states untouched by a closure it omits for an invalid range', () => {
    const d = dataset();
    const buildRows = (data: AppData) =>
      buildSchedulerModel({
        data,
        geom,
        days,
        visibleWindow: { start, end },
        overSoonWindow: { start, end },
        filters: buildEmptyFilters(),
        preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
      })
        .flatMap((group) => group.rows)
        .map(({ resource, dayStates, utilization }) => ({
          id: resource.id,
          dayStates,
          utilization,
        }));
    const clean = buildRows(d);
    expect(clean.some((row) => row.dayStates.some((state) => !state.creationBlocked))).toBe(true);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const corruptClosure = {
      id: 'corrupt-closure',
      accountId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Company shutdown',
      startDate: '2026-02-30',
      endDate: end,
    };

    expect(buildRows({ ...d, closures: [corruptClosure] })).toEqual(clean);
    expect(error).toHaveBeenCalledWith(
      `Scheduler omitted ${corruptClosure.id}: invalid date range.`,
    );
    error.mockRestore();
  });
});

function buildNonActiveResourceData(): AppData {
  const d = dataset();
  d.disciplines.push(
    {
      id: 'd-ops',
      color: null,
      accountId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Ops',
      sortOrder: 2,
    },
    {
      id: 'd-qa',
      color: null,
      accountId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'QA',
      sortOrder: 3,
    },
  );
  d.resources.push(
    makeResource({
      id: 'r-arch',
      accountId: 'acct-test',
      archivedAt: '2026-05-01T00:00:00.000Z',
      name: 'Archived Ann',
      role: 'Ops',
      disciplineId: 'd-ops',
      color: '#6',
    }),

    makeResource({
      id: 'r-del',
      accountId: 'acct-test',
      archivedAt: '2026-05-01T00:00:00.000Z',
      deletedAt: '2026-05-20T00:00:00.000Z',
      name: 'Deleted Del',
      role: 'QA',
      disciplineId: 'd-qa',
      color: '#7',
    }),
  );

  d.allocations.push(
    makeAllocation({ id: 'a-arch', accountId: 'acct-test', resourceId: 'r-arch' }),
    makeAllocation({ id: 'a-del', accountId: 'acct-test', resourceId: 'r-del' }),
  );
  return d;
}

describe('buildSchedulerModel(activeOnly(data), …) — non-active resources vanish (P2.4)', () => {
  const buildActive = (d: AppData) =>
    buildSchedulerModel({
      data: activeOnly(d),
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });

  // Exercise the shared active-only projection before modeling so retained inactive rows cannot create normal schedule lanes.
  const withNonActive: () => AppData = buildNonActiveResourceData;
  it('RAW data renders the archived + deleted lanes; the active-only projection does NOT', () => {
    const d = withNonActive();

    const raw = buildSchedulerModel({
      data: d,
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const rawResourceIds = raw.flatMap((g) => g.rows).map((r) => r.resource.id);
    expect(rawResourceIds).toEqual(expect.arrayContaining(['r1', 'r2', 'r-arch', 'r-del']));

    const model = buildActive(d);
    const resourceIds = model.flatMap((g) => g.rows).map((r) => r.resource.id);

    expect(resourceIds).toEqual(['r1', 'r2']);
    expect(resourceIds).not.toContain('r-arch');
    expect(resourceIds).not.toContain('r-del');

    const barIdsAll = barIds(model);
    expect(barIdsAll).not.toContain('a-arch');
    expect(barIdsAll).not.toContain('a-del');

    expect(model.map((g) => g.title)).not.toContain('Ops');
    expect(model.map((g) => g.title)).not.toContain('QA');
  });

  it('hides scheduled work beneath an archived client', () => {
    const d = dataset();
    d.clients.push({
      ...NULLABLE_FIELDS.clients,
      id: 'c-arch',
      accountId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Gone Co',
      color: '#8',
      archivedAt: '2026-05-01T00:00:00.000Z',
    });
    d.projects.push({
      ...NULLABLE_FIELDS.projects,
      id: 'p-orphan',
      accountId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Orphan P',
      clientId: 'c-arch',
      color: '#9',
    });
    d.activities.push({
      ...NULLABLE_FIELDS.activities,
      id: 't-orphan',
      accountId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Orphan T',
      kind: 'project',
      projectId: 'p-orphan',
    });
    d.allocations.push({
      ...NULLABLE_FIELDS.allocations,
      id: 'a-orphan',
      accountId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: 'r1',
      activityId: 't-orphan',
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      hoursPerDay: 8,
      status: 'confirmed',
    });
    const model = buildActive(d);
    const barIdsAll = barIds(model);
    expect(barIdsAll).not.toContain('a-orphan');
  });
});
