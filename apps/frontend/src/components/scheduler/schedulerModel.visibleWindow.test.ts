import { createEmptyAppData } from '@capacitylens/shared/types/entities';
import { describe, it, expect } from 'vitest';
import { buildSchedulerModel, applyVisibleUtilisation } from './schedulerModel';
import type { GroupModel } from './schedulerModel';
import { buildColumnGeometry } from './columnGeometry';
import { listDaysISO } from '@capacitylens/shared/lib/dateMath';
import { buildEmptyFilters } from '@/store/useStore';
import type { AppData, ISODate } from '@capacitylens/shared/types/entities';
import { capacityOver } from '@/test/capacityFixtures';
import { makeActivity, makeClient, makeProject, makeResource, requireValue } from '@/test/fixtures';
import { makeDataset, days, end, geom, makeDisciplines, start } from './schedulerModelTestKit';

const dataset = () => makeDataset(makeDisciplines());

const timeline = { from: start, to: end };

describe('buildSchedulerModel', () => {
  it('displayed utilisation % follows the VISIBLE window (visStart/visEnd), not the whole timeline', () => {
    // The days outside the visible window are fully booked, so summing the timeline would read higher.
    const capacity = capacityOver(timeline, {
      r1: { fill: { allocated: 8 }, byDate: { '2026-06-04': { allocated: 0 } } },
    });
    const model = buildSchedulerModel({
      data: dataset(),
      geom,
      days,
      visibleWindow: { start: '2026-06-03', end: '2026-06-04' },
      capacity,
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
    expect(r1.utilisation).toBeCloseTo(0.5);

    expect(r1.dayStates.length).toBe(days.length);
  });

  it("overSoon is the server's flag, independent of the visible window", () => {
    // No visible day is over, yet the server reports an over day in its fixed forward window.
    const rows = buildSchedulerModel({
      data: dataset(),
      geom,
      days,
      visibleWindow: { start: '2026-06-03', end: '2026-06-04' },
      capacity: capacityOver(timeline, { r1: { overSoon: true }, r2: {} }),
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
    const capacity = capacityOver(timeline, {
      r1: {
        byDate: { '2026-06-03': { allocated: 0, available: 0 }, '2026-06-04': { allocated: 4 } },
      },
      r2: { fill: { allocated: 8 } },
    });
    const base = buildSchedulerModel({
      data,
      geom,
      days,
      visibleWindow: { start: '2026-06-01', end: '2026-06-02' },
      capacity,
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const refreshed = applyVisibleUtilisation({
      model: base,
      capacity,
      start: '2026-06-03',
      end: '2026-06-05',
    });
    const rebuilt = buildSchedulerModel({
      data,
      geom,
      days,
      visibleWindow: { start: '2026-06-03', end: '2026-06-05' },
      capacity,
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const utilisationByResource = (groups: GroupModel[]) =>
      Object.fromEntries(
        groups.flatMap((group) => group.rows.map((row) => [row.resource.id, row.utilisation])),
      );
    expect(utilisationByResource(refreshed)).toEqual(utilisationByResource(rebuilt));
    // The day with no availability is left out: 4 of 16 hours.
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
    ...createEmptyAppData(),
    clients: [makeClient({ companyId: 'acct-test', name: 'Ferris', color: '#1' })],
    projects: [makeProject({ companyId: 'acct-test', name: 'P1', color: '#2' })],
    activities: [makeActivity({ companyId: 'acct-test', name: 'T1' })],
    resources: [
      makeResource({
        id: 'r1',
        companyId: 'acct-test',
        name: 'Dana',
        jobTitle: 'Designer',
        color: '#4',
      }),
    ],
    timeOff: [],
  };
}

describe('displayed utilisation % over the visible window (1/2/4/8 weeks)', () => {
  const winStart = '2026-06-01';
  const winDays = listDaysISO('2026-06-01', '2026-07-26');
  const winRange = { from: winStart, to: '2026-07-26' };
  const winGeom = buildColumnGeometry(winDays, 48, { minimiseWeekends: false, weekendWidth: 22 });
  // The server's figures: eight hours on weekdays, none at weekends; 8, 4, then 2 hours booked per
  // weekday in weeks 1, 2 and 3–4, and nothing after.
  const bookedPerWeekday = (date: ISODate) =>
    date <= '2026-06-05' ? 8 : date <= '2026-06-12' ? 4 : date <= '2026-06-26' ? 2 : 0;
  const densityCapacity = capacityOver(winRange, {
    r1: {
      byDate: Object.fromEntries(
        winDays.map((date, index) =>
          index % 7 >= 5
            ? [date, { available: 0 }]
            : [date, { allocated: bookedPerWeekday(date), available: 8 }],
        ),
      ),
    },
  });
  const buildWindowModel = (visEnd: string, capacity = densityCapacity) =>
    buildSchedulerModel({
      data: buildVisibleWindowDensityData(),
      geom: winGeom,
      days: winDays,
      visibleWindow: { start: winStart, end: visEnd },
      capacity,
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: false,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
  const utilOver = (visEnd: string): number =>
    requireValue(
      buildWindowModel(visEnd)
        .flatMap((g) => g.rows)
        .find((r) => r.resource.id === 'r1'),
      'r1 scheduler row',
    ).utilisation;

  const buildBoundaryModel = (bookedDate: ISODate) =>
    buildWindowModel(
      '2026-06-07',
      capacityOver(winRange, { r1: { byDate: { [bookedDate]: { allocated: 8 } } } }),
    );

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
    // Every day of the fixture has eight hours available, so the week holds 56.
    const inModel = buildBoundaryModel('2026-06-07');
    expect(inModel.flatMap((g) => g.rows)[0]?.utilisation).toBeCloseTo(8 / 56);

    const afterModel = buildBoundaryModel('2026-06-08');
    expect(afterModel.flatMap((g) => g.rows)[0]?.utilisation).toBe(0);
  });
});
