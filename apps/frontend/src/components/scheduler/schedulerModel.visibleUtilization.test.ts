import { afterEach, describe, expect, it, vi } from 'vitest';
import { eachDayISO } from '@capacitylens/shared/lib/dateMath';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { AppData, ISODate } from '@capacitylens/shared/types/entities';
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { buildEmptyFilters } from '@/store/useStore';
import {
  makeActivity,
  makeAllocation,
  makeClosure,
  makeResource,
  makeTimeOff,
  requireValue,
} from '@/test/fixtures';
import { buildColumnGeometry } from './columnGeometry';
import { applyVisibleUtilization, buildSchedulerModel } from './schedulerModel';
import type { GroupModel, RowModel } from './schedulerModel';

const ACCOUNT = 'a-studio';
const FULL = { start: '2026-06-01', end: '2026-06-14' } as const;
// Only the long allocation reaches the second week, so it alone sets that window's lanes.
const SECOND_WEEK = { start: '2026-06-08', end: '2026-06-14' } as const;
const days = eachDayISO(FULL.start, FULL.end);
const geom = buildColumnGeometry(days, 48, { minimiseWeekends: false, weekendWidth: 22 });

function discipline(
  id: string,
  name: string,
  color: string | null,
): AppData['disciplines'][number] {
  return {
    ...NULLABLE_FIELDS.disciplines,
    id,
    accountId: ACCOUNT,
    createdAt: 't',
    updatedAt: 't',
    name,
    sortOrder: id === 'd-design' ? 0 : 1,
    color,
  };
}

function allocation(id: string, resourceId: string, startDate: ISODate, endDate: ISODate) {
  return makeAllocation({ id, accountId: ACCOUNT, resourceId, startDate, endDate, hoursPerDay: 4 });
}

// Bruce Wayne carries two overlapping allocations (two lanes over the fortnight, one in the second
// week); Alfred Pennyworth has no work at all; Kord Industries is an external partner with the
// same overlapping shape.
function dataset(): AppData {
  return {
    ...emptyAppData(),
    disciplines: [discipline('d-design', 'Design', null)],
    activities: [makeActivity({ id: 't1', accountId: ACCOUNT, kind: 'internal' })],
    resources: [
      makeResource({ id: 'r1', accountId: ACCOUNT, name: 'Bruce Wayne', disciplineId: 'd-design' }),
      makeResource({
        id: 'r2',
        accountId: ACCOUNT,
        name: 'Alfred Pennyworth',
        disciplineId: 'd-design',
      }),
      makeResource({ id: 'ext1', accountId: ACCOUNT, kind: 'external', name: 'Kord Industries' }),
    ],
    allocations: [
      allocation('a1', 'r1', '2026-06-01', '2026-06-03'),
      allocation('a2', 'r1', '2026-06-02', '2026-06-10'),
      allocation('x1', 'ext1', '2026-06-01', '2026-06-03'),
      allocation('x2', 'ext1', '2026-06-02', '2026-06-10'),
    ],
  };
}

function buildModel(data: AppData, window: { start: ISODate; end: ISODate } = FULL) {
  return buildSchedulerModel({
    data,
    geom,
    days,
    visibleWindow: window,
    overSoonWindow: window,
    filters: buildEmptyFilters(),
    preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
  });
}

function project(
  model: GroupModel[],
  data: AppData,
  window: { start: ISODate; end: ISODate },
  partiallyExposesNextColumn?: boolean,
) {
  return applyVisibleUtilization({
    model,
    data,
    ...window,
    accountWorkingDays: [1, 2, 3, 4, 5],
    ...(partiallyExposesNextColumn === undefined ? {} : { partiallyExposesNextColumn }),
  });
}

function rowOf(model: GroupModel[], resourceId: string): RowModel {
  return requireValue(
    model.flatMap((group) => group.rows).find((row) => row.resource.id === resourceId),
  );
}

// Replace one row in a model, leaving every other row and group object untouched.
function withRow(model: GroupModel[], replacement: RowModel): GroupModel[] {
  return model.map((group) =>
    group.rows.some((row) => row.resource.id === replacement.resource.id)
      ? {
          ...group,
          rows: group.rows.map((row) =>
            row.resource.id === replacement.resource.id ? replacement : row,
          ),
        }
      : group,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyVisibleUtilization identity', () => {
  it('returns every group and row by identity when nothing in view changed', () => {
    const data = dataset();
    const model = buildModel(data);
    const projected = project(model, data, FULL);
    expect(projected).toHaveLength(model.length);
    projected.forEach((group, index) => expect(group).toBe(model[index]));
  });

  it('gives a resource with no allocations or time off zero utilisation, not a stale row', () => {
    const data = dataset();
    const model = buildModel(data);
    const projected = project(model, data, SECOND_WEEK);
    expect(rowOf(projected, 'r2')).toBe(rowOf(model, 'r2'));
    expect(rowOf(projected, 'r2').utilization).toBe(0);
  });

  it('replaces only the group whose row changed, keeping its unchanged rows', () => {
    const data = dataset();
    const model = buildModel(data);
    const projected = project(model, data, SECOND_WEEK);
    const designIndex = model.findIndex((group) => group.key === 'd-design');
    expect(projected[designIndex]).not.toBe(model[designIndex]);
    expect(rowOf(projected, 'r1')).not.toBe(rowOf(model, 'r1'));
    expect(rowOf(projected, 'r2')).toBe(rowOf(model, 'r2'));
  });

  it.each(['r1', 'ext1'])('recomputes %s when only its bars changed', (resourceId) => {
    const data = dataset();
    const model = buildModel(data);
    const narrowed = rowOf(project(model, data, SECOND_WEEK), resourceId);
    const stale = { ...narrowed, bars: rowOf(model, resourceId).bars };
    expect(stale.bars).not.toEqual(narrowed.bars);
    const projected = rowOf(project(withRow(model, stale), data, SECOND_WEEK), resourceId);
    expect(projected).not.toBe(stale);
    expect(projected.bars).toEqual(narrowed.bars);
  });

  it.each(['r1', 'ext1'])('recomputes %s when only its row height changed', (resourceId) => {
    const data = dataset();
    const model = buildModel(data);
    const narrowed = rowOf(project(model, data, SECOND_WEEK), resourceId);
    const stale = { ...narrowed, rowHeight: rowOf(model, resourceId).rowHeight };
    expect(stale.rowHeight).not.toBe(narrowed.rowHeight);
    const projected = rowOf(project(withRow(model, stale), data, SECOND_WEEK), resourceId);
    expect(projected).not.toBe(stale);
    expect(projected.rowHeight).toBe(narrowed.rowHeight);
  });

  it('recomputes a tracked row whose utilisation alone is stale', () => {
    const data = dataset();
    const model = buildModel(data);
    const row = rowOf(model, 'r1');
    const projected = rowOf(
      project(withRow(model, { ...row, utilization: 0.123 }), data, FULL),
      'r1',
    );
    expect(projected.utilization).toBe(row.utilization);
    expect(projected.bars).toBe(row.bars);
  });

  it('keeps an external row at zero utilisation even when its work carries hours', () => {
    const data = dataset();
    const model = buildModel(data);
    const row = rowOf(model, 'ext1');
    expect(row.utilization).toBe(0);
    const projected = rowOf(
      project(withRow(model, { ...row, utilization: 0.5 }), data, FULL),
      'ext1',
    );
    expect(projected.utilization).toBe(0);
    expect(projected.bars).toBe(row.bars);
    expect(rowOf(project(model, data, SECOND_WEEK), 'ext1').utilization).toBe(0);
  });
});

describe('applyVisibleUtilization inputs', () => {
  it('packs only the visible window unless the next column is partially exposed', () => {
    // The second allocation only overlaps the first on the day after the visible week.
    const data = dataset();
    data.allocations = [
      allocation('p', 'r1', '2026-06-05', '2026-06-09'),
      allocation('q', 'r1', '2026-06-08', '2026-06-09'),
    ];
    const model = buildModel(data);
    const week = { start: '2026-06-01', end: '2026-06-07' } as const;
    const byDefault = rowOf(project(model, data, week), 'r1');
    expect(byDefault).toEqual(rowOf(project(model, data, week, false), 'r1'));
    expect(byDefault.rowHeight).toBeLessThan(
      rowOf(project(model, data, week, true), 'r1').rowHeight,
    );
  });

  const invalid = { startDate: '2026-02-30', endDate: '2026-06-05' } as const;
  it.each([
    [
      'allocation',
      (data: AppData) =>
        data.allocations.push(allocation('bad', 'r1', invalid.startDate, invalid.endDate)),
    ],
    [
      'time off',
      (data: AppData) =>
        data.timeOff.push(makeTimeOff({ id: 'bad', accountId: ACCOUNT, ...invalid })),
    ],
    [
      'closure',
      (data: AppData) =>
        data.closures.push(makeClosure({ id: 'bad', accountId: ACCOUNT, ...invalid })),
    ],
  ])('omits an invalid %s from utilisation and reports it once', (_table, addInvalid) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const data = dataset();
    const model = buildModel(data);
    const corrupt = dataset();
    addInvalid(corrupt);
    expect(project(model, corrupt, FULL)).toEqual(project(model, data, FULL));
    expect(project(model, corrupt, FULL)).toEqual(project(model, data, FULL));
    expect(error).toHaveBeenCalledExactlyOnceWith('Scheduler omitted bad: invalid date range.');
  });
});

describe('buildSchedulerModel grouping and order', () => {
  // Day states read closures separately; this pins only the capacity path the model filters.
  it('omits an invalid closure from rendered utilisation', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const corrupt = dataset();
    corrupt.closures.push(
      makeClosure({
        id: 'bad',
        accountId: ACCOUNT,
        startDate: '2026-02-30',
        endDate: '2026-06-05',
      }),
    );
    const utilisationOf = (model: GroupModel[]) =>
      model.flatMap((group) => group.rows.map((row) => [row.resource.id, row.utilization]));
    expect(utilisationOf(buildModel(corrupt))).toEqual(utilisationOf(buildModel(dataset())));
  });

  it('keys unassigned resources by the unassigned band and colours only coloured disciplines', () => {
    const data = dataset();
    data.disciplines.push(discipline('d-dev', 'Development', '#2d75da'));
    data.resources.push(
      makeResource({ id: 'r3', accountId: ACCOUNT, name: 'Lucius Fox', disciplineId: 'd-dev' }),
      makeResource({ id: 'r4', accountId: ACCOUNT, name: 'Barbara Gordon' }),
    );
    const groups = buildModel(data);
    expect(groups.map((group) => group.key)).toEqual([
      'd-design',
      'd-dev',
      'unassigned',
      'external',
    ]);
    const byKey = new Map(groups.map((group) => [group.key, group]));
    expect(byKey.get('d-design')).not.toHaveProperty('color');
    expect(byKey.get('d-dev')).toHaveProperty('color', '#2d75da');
  });

  it('orders people by display name and placeholders by id after them', () => {
    const data = dataset();
    data.resources = [
      makeResource({ id: 'r1', accountId: ACCOUNT, name: 'Selina Kyle', disciplineId: 'd-design' }),
      makeResource({ id: 'r2', accountId: ACCOUNT, name: 'Bruce Wayne', disciplineId: 'd-design' }),
      makeResource({
        id: 'ph-a',
        accountId: ACCOUNT,
        kind: 'placeholder',
        name: 'Zatanna slot',
        disciplineId: 'd-design',
      }),
      makeResource({
        id: 'ph-b',
        accountId: ACCOUNT,
        kind: 'placeholder',
        name: 'Alfred slot',
        isFavourite: true,
        disciplineId: 'd-design',
      }),
    ];
    data.allocations = [];
    const ids = buildModel(data).flatMap((group) => group.rows.map((row) => row.resource.id));
    expect(ids).toEqual(['r2', 'r1', 'ph-a', 'ph-b']);
  });

  it('marks each series bar with the latest valid end in its series', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const data = dataset();
    data.allocations = [
      { ...allocation('s-late', 'r1', '2026-06-08', '2026-06-10'), seriesId: 's1' },
      { ...allocation('s-early', 'r1', '2026-06-01', '2026-06-03'), seriesId: 's1' },
      { ...allocation('s-bad', 'r1', '2026-06-04', '2026-99-99'), seriesId: 's1' },
      allocation('single', 'r1', '2026-06-04', '2026-06-05'),
    ];
    const bars = rowOf(buildModel(data), 'r1').bars;
    const seriesEndOf = (id: string) =>
      requireValue(bars.find((bar) => bar.allocation.id === id)).seriesEnd;
    expect(seriesEndOf('s-early')).toBe('2026-06-10');
    expect(seriesEndOf('s-late')).toBe('2026-06-10');
    expect(seriesEndOf('single')).toBeUndefined();
  });
});
