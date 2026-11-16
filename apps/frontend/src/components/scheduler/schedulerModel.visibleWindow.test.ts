import { emptyAppData } from '@capacitylens/shared/types/entities';
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { describe, it, expect } from 'vitest';
import { buildSchedulerModel, applyVisibleUtilization } from './schedulerModel';
import type { GroupModel } from './schedulerModel';
import { buildColumnGeometry } from './columnGeometry';
import { eachDayISO } from '@capacitylens/shared/lib/dateMath';
import { buildEmptyFilters } from '@/store/useStore';
import type { AppData, ISODate } from '@capacitylens/shared/types/entities';
import {
  makeActivity,
  makeAllocation,
  makeClient,
  makeProject,
  makeResource,
  requireValue,
} from '@/test/fixtures';
import {
  DEFAULT_ACCOUNT_WORKING_DAYS,
  dataset as buildDataset,
  days,
  end,
  geom,
  makeDisciplines,
  start,
} from './schedulerModel.testSupport';

const dataset = () => buildDataset(makeDisciplines());

describe('buildSchedulerModel', () => {
  it('displayed utilisation % follows the VISIBLE window (visStart/visEnd), not the whole timeline', () => {
    const model = buildSchedulerModel({
      data: dataset(),
      geom: geom,
      days: days,
      visibleWindow: { start: '2026-06-03', end: '2026-06-04' },
      overSoonWindow: { start: start, end: end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const r1 = requireValue(
      model.flatMap((g) => g.rows).find((r) => r.resource.id === 'r1'),
      'r1 scheduler row',
    );
    expect(r1.utilization).toBeCloseTo(0.5);

    expect(r1.dayStates.length).toBe(days.length);
  });

  it('overSoon stays on the FIXED forward window — independent of the visible window', () => {
    const d = dataset();

    d.allocations.push({
      ...NULLABLE_FIELDS.allocations,
      id: 'a4',
      accountId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: 'r1',
      activityId: 't1',
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      hoursPerDay: 8,
      status: 'confirmed',
    });
    // overSoon uses its fixed forward window even when the visible utilisation window contains no conflict.
    const rows = buildSchedulerModel({
      data: d,
      geom: geom,
      days: days,
      visibleWindow: { start: '2026-06-03', end: '2026-06-04' },
      overSoonWindow: { start: '2026-06-01', end: '2026-06-02' },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    }).flatMap((g) => g.rows);
    expect(
      requireValue(
        rows.find((r) => r.resource.id === 'r1'),
        'r1 scheduler row',
      ).overSoon,
    ).toBe(true);
    expect(
      requireValue(
        rows.find((r) => r.resource.id === 'r2'),
        'r2 scheduler row',
      ).overSoon,
    ).toBe(false);
  });

  it('refreshes visible utilisation without rebuilding static schedule rows', () => {
    const data = dataset();
    data.closures.push({
      id: 'company-wednesday',
      accountId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Company shutdown',
      startDate: '2026-06-03',
      endDate: '2026-06-03',
    });
    const base = buildSchedulerModel({
      data,
      geom,
      days,
      visibleWindow: { start: '2026-06-01', end: '2026-06-02' },
      overSoonWindow: { start, end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const refreshed = applyVisibleUtilization({
      model: base,
      data,
      start: '2026-06-03',
      end: '2026-06-05',
      accountWorkingDays: DEFAULT_ACCOUNT_WORKING_DAYS,
    });
    const rebuilt = buildSchedulerModel({
      data,
      geom,
      days,
      visibleWindow: { start: '2026-06-03', end: '2026-06-05' },
      overSoonWindow: { start, end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const utilisationByResource = (groups: GroupModel[]) =>
      Object.fromEntries(
        groups.flatMap((group) => group.rows.map((row) => [row.resource.id, row.utilization])),
      );
    expect(utilisationByResource(refreshed)).toEqual(utilisationByResource(rebuilt));
    expect(utilisationByResource(refreshed).r1).toBe(0.25);

    const baseRow = requireValue(requireValue(base[0], 'base group').rows[0], 'base row');
    const refreshedRow = requireValue(
      requireValue(refreshed[0], 'refreshed group').rows[0],
      'refreshed row',
    );
    expect(refreshedRow.bars).toBe(baseRow.bars);
    expect(refreshedRow.dayStates).toBe(baseRow.dayStates);
    expect(refreshedRow.timeOff).toBe(baseRow.timeOff);
  });
});

function buildVisibleWindowDensityData(): AppData {
  return {
    ...emptyAppData(),
    clients: [makeClient({ accountId: 'acct-test', name: 'Ferris', color: '#1' })],
    projects: [makeProject({ accountId: 'acct-test', name: 'P1', color: '#2' })],
    activities: [makeActivity({ accountId: 'acct-test', name: 'T1' })],
    resources: [
      makeResource({
        id: 'r1',
        accountId: 'acct-test',
        name: 'Dana',
        role: 'Designer',
        color: '#4',
      }),
    ],
    allocations: [
      makeAllocation({
        id: 'w1',
        accountId: 'acct-test',
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        hoursPerDay: 8,
      }),

      makeAllocation({
        id: 'w2',
        accountId: 'acct-test',
        startDate: '2026-06-08',
        endDate: '2026-06-12',
        hoursPerDay: 4,
      }),

      makeAllocation({
        id: 'w34',
        accountId: 'acct-test',
        startDate: '2026-06-15',
        endDate: '2026-06-26',
        hoursPerDay: 2,
      }),
    ],
    timeOff: [],
  };
}

describe('displayed utilisation % over the visible window (1/2/4/8 weeks)', () => {
  const winStart = '2026-06-01';
  const winDays = eachDayISO('2026-06-01', '2026-07-26');
  const winGeom = buildColumnGeometry(winDays, 48, { minimiseWeekends: false, weekendWidth: 22 });
  const utilOver = (visEnd: string): number => {
    const model = buildSchedulerModel({
      data: buildVisibleWindowDensityData(),
      geom: winGeom,
      days: winDays,
      visibleWindow: { start: winStart, end: visEnd },
      overSoonWindow: { start: winStart, end: winStart },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: false,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    return requireValue(
      model.flatMap((g) => g.rows).find((r) => r.resource.id === 'r1'),
      'r1 scheduler row',
    ).utilization;
  };

  const buildBoundaryModel = (id: string, allocationDate: ISODate) =>
    buildSchedulerModel({
      data: {
        ...buildVisibleWindowDensityData(),
        allocations: [
          makeAllocation({
            id,
            accountId: 'acct-test',
            startDate: allocationDate,
            endDate: allocationDate,
          }),
        ],
      },
      geom: winGeom,
      days: winDays,
      visibleWindow: { start: winStart, end: '2026-06-07' },
      overSoonWindow: { start: winStart, end: winStart },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: false,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });

  // Use distinct booking density in each zoom window so visible utilisation must change when the window changes. An inclusive-edge booking separately pins the end boundary.
  it('1 week → 100% (week-1 density only)', () => {
    expect(utilOver('2026-06-07')).toBeCloseTo(1.0);
  });
  it('2 weeks → 75% (weeks 1–2)', () => {
    expect(utilOver('2026-06-14')).toBeCloseTo(0.75);
  });
  it('4 weeks → 50% (weeks 1–4)', () => {
    expect(utilOver('2026-06-28')).toBeCloseTo(0.5);
  });
  it('6 weeks → 33% (weeks 1–6, weeks 5–6 idle)', () => {
    expect(utilOver('2026-07-12')).toBeCloseTo(1 / 3);
  });
  it('8 weeks → 25% (weeks 1–8, second half idle)', () => {
    expect(utilOver('2026-07-26')).toBeCloseTo(0.25);
  });
  it('the five zoom spans produce five DISTINCT numbers (the toggle genuinely recalculates)', () => {
    const nums = [
      utilOver('2026-06-07'),
      utilOver('2026-06-14'),
      utilOver('2026-06-28'),
      utilOver('2026-07-12'),
      utilOver('2026-07-26'),
    ];
    expect(new Set(nums.map((n) => Math.round(n * 100))).size).toBe(5);
  });

  it('inclusive-end boundary: a booking on the visible window LAST day counts; the day AFTER does not', () => {
    const inModel = buildBoundaryModel('in', '2026-06-05');
    expect(inModel.flatMap((g) => g.rows)[0]?.utilization).toBeCloseTo(0.2);

    const afterModel = buildBoundaryModel('af', '2026-06-08');
    expect(afterModel.flatMap((g) => g.rows)[0]?.utilization).toBe(0);
  });
});
