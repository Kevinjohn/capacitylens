import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { describe, expect, it } from 'vitest';
import { buildEmptyFilters } from '@/store/useStore';
import { makeAllocation, makeResource, requireValue } from '@/test/fixtures';
import { capacityOver } from '@/test/capacityFixtures';
import { buildSchedulerModel } from './schedulerModel';
import {
  listAllBars,
  build,
  makeDataset,
  days,
  end,
  geom,
  start,
} from './schedulerModel.testSupport';

function buildBlockTimeOffRows() {
  const d = makeDataset();
  d.allocations = [
    {
      ...requireValue(d.allocations[0], 'a1 allocation'),
      startDate: '2026-06-01',
      endDate: '2026-06-07',
      hoursPerDay: 8,
    },
  ];
  d.timeOff = [
    {
      id: 'to-r1-tuesday',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: 'r1',
      startDate: '2026-06-02',
      endDate: '2026-06-02',
      type: 'holiday',
      note: null,
    },
    {
      id: 'to-r2-wednesday',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: 'r2',
      startDate: '2026-06-03',
      endDate: '2026-06-03',
      type: 'holiday',
      note: null,
    },
  ];

  const model = buildSchedulerModel({
    data: d,
    geom,
    days,
    visibleWindow: { start, end },
    capacity: null,
    filters: buildEmptyFilters(),
    preferences: {
      disciplinesEnabled: true,
      placeholdersEnabled: true,
      externalEnabled: true,

      companyWorkingDays: [1, 2, 3, 4],
      blocksMode: true,
    },
  });
  const rows = model.flatMap((group) => group.rows);
  const r1 = requireValue(
    rows.find((row) => row.resource.id === 'r1'),
    'r1 scheduler row',
  );
  const r2 = requireValue(
    rows.find((row) => row.resource.id === 'r2'),
    'r2 scheduler row',
  );

  return { r1, r2 };
}

describe('buildSchedulerModel — mutation-testing gap-fill', () => {
  it('search is TRIMMED before matching (leading/trailing whitespace is not part of the term)', () => {
    const d = makeDataset();
    // Use a single-occurrence search term so a duplicate name or role cannot accidentally rescue an untrimmed query.
    d.resources.push(
      makeResource({
        id: 'r-zed',
        companyId: 'acct-test',
        name: 'Zed',
        role: 'Zed',
        disciplineId: 'd-design',
        color: '#a',
      }),
    );
    const model = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: { ...buildEmptyFilters(), search: 'zed ' },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const ids = model.flatMap((g) => g.rows).map((r) => r.resource.id);
    expect(ids).toContain('r-zed');
  });
  it('search falls back to an EMPTY string (not a literal placeholder) when resource.name is undefined', () => {
    const d = makeDataset();
    const firstResource = d.resources[0];
    expect(firstResource).toBeDefined();
    if (!firstResource) throw new Error('Expected the base scheduler resource.');
    const resourceWithoutName = { ...firstResource };
    resourceWithoutName.name = null;
    d.resources[0] = resourceWithoutName;

    const model = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: { ...buildEmptyFilters(), search: 'stryker' },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    expect(model.flatMap((g) => g.rows).map((r) => r.resource.id)).not.toContain('r1');
  });
  it('a placeholder IS searchable by its own (unusual, but allowed) `name` field', () => {
    const d = makeDataset();
    d.resources.push(
      makeResource({
        id: 'ph-named',
        companyId: 'acct-test',
        kind: 'placeholder',
        name: 'Zibblequork',
        role: 'Designer',
        disciplineId: 'd-design',
        color: '#b',
      }),
    );
    const model = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: { ...buildEmptyFilters(), search: 'zibblequork' },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    expect(model.flatMap((g) => g.rows).map((r) => r.resource.id)).toContain('ph-named');
  });
  it('bar.project / bar.client resolve through the projectById / clientById maps (real lookups, not empty maps)', () => {
    const model = build();
    const a1 = requireValue(
      listAllBars(model).find((b) => b.allocation.id === 'a1'),
      'a1 bar',
    );
    expect(a1.project).toBe('P1');
    expect(a1.client).toBe('Ferris');
  });
  it('an internal activity bar is always neutral grey', () => {
    const d = makeDataset();
    d.activities.push({
      ...NULLABLE_FIELDS.activities,
      id: 't-int',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Admin',
      kind: 'internal',
    });
    d.allocations.push(
      makeAllocation({
        id: 'a-int',
        companyId: 'acct-test',
        activityId: 't-int',
        startDate: '2026-06-05',
        endDate: '2026-06-05',
      }),
    );
    const greyModel = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const greyBar = requireValue(
      listAllBars(greyModel).find((b) => b.allocation.id === 'a-int'),
      'internal bar',
    );
    expect(greyBar.color).toBe('#9ca3af');
  });
  it('does not throw when there are no clients at all (scopedCompanyId derivation is optional-chained)', () => {
    const d = { ...makeDataset(), clients: [] };
    expect(() =>
      buildSchedulerModel({
        data: d,
        geom,
        days,
        visibleWindow: { start, end },
        capacity: null,
        filters: buildEmptyFilters(),
        preferences: {
          disciplinesEnabled: true,
          placeholdersEnabled: true,
          externalEnabled: true,
        },
      }),
    ).not.toThrow();
  });
  it('positions time-off blocks with real fields (id/x/width/label/note), and marks only its OWN days unavailable', () => {
    const d = makeDataset();
    // Time-off indexing must accumulate all entries for a resource rather than replace earlier entries.
    d.timeOff.push(
      {
        id: 'to1',
        companyId: 'acct-test',
        createdAt: 't',
        updatedAt: 't',
        resourceId: 'r1',
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        type: 'holiday',
        note: 'day one',
      },
      {
        id: 'to2',
        companyId: 'acct-test',
        createdAt: 't',
        updatedAt: 't',
        resourceId: 'r1',
        startDate: '2026-06-02',
        endDate: '2026-06-02',
        type: 'sick',
        note: null,
      },
    );
    const model = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
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
    expect(r1.timeOff).toHaveLength(2);
    const t1 = requireValue(
      r1.timeOff.find((t) => t.id === 'to1'),
      'to1 time-off block',
    );
    expect(t1.x).toBe(geom.getDateX('2026-06-01'));
    expect(t1.width).toBe(geom.getDatesWidth('2026-06-01', '2026-06-01'));
    expect(t1.note).toBe('day one');
    expect(typeof t1.label).toBe('string');
    expect(t1.label.length).toBeGreaterThan(0);

    expect(r1.dayStates[0]?.unavailable).toBe(true);

    expect(r1.dayStates[2]?.unavailable).toBe(false);
  });
  it('signals saved half days only when the date retains partial capacity', () => {
    const d = makeDataset();
    const resource = requireValue(
      d.resources.find((candidate) => candidate.id === 'r1'),
      'r1 resource',
    );
    resource.halfDays = [1, 2, 5];
    d.timeOff.push({
      ...NULLABLE_FIELDS.timeOff,
      id: 'to-r1-monday',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: 'r1',
      startDate: '2026-06-01',
      endDate: '2026-06-01',
      type: 'holiday',
      note: null,
    });

    const row = requireValue(
      buildSchedulerModel({
        data: d,
        geom,
        days,
        visibleWindow: { start, end },
        // The server's figures: no capacity on the holiday Monday or past the four-day week, and an
        // over-booked half-day Tuesday.
        capacity: capacityOver(
          { from: start, to: end },
          {
            r1: {
              byDate: {
                '2026-06-01': { available: 0 },
                '2026-06-02': { allocated: 8, available: 4, over: true },
                '2026-06-05': { available: 0 },
                '2026-06-06': { available: 0 },
                '2026-06-07': { available: 0 },
              },
            },
          },
        ),
        filters: buildEmptyFilters(),
        preferences: {
          disciplinesEnabled: true,
          placeholdersEnabled: true,
          externalEnabled: true,
          companyWorkingDays: [1, 2, 3, 4],
        },
      })
        .flatMap((group) => group.rows)
        .find((candidate) => candidate.resource.id === 'r1'),
      'r1 scheduler row',
    );

    expect(row.dayStates.map((state) => state.partialCapacity)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(row.dayStates[0]).toMatchObject({ unavailable: true, partialCapacity: false });
    expect(row.dayStates[1]).toMatchObject({
      unavailable: false,
      partialCapacity: true,
      over: true,
    });
    expect(row.dayStates[4]).toMatchObject({ unavailable: true, partialCapacity: false });
  });
  it('marks a holiday the server flags over as a time-off conflict, and only that day', () => {
    const d = makeDataset();

    d.timeOff.push(
      {
        id: 'to-r1-tuesday',
        companyId: 'acct-test',
        createdAt: 't',
        updatedAt: 't',
        resourceId: 'r1',
        startDate: '2026-06-02',
        endDate: '2026-06-02',
        type: 'holiday',
        note: null,
      },
      {
        id: 'to-r2-wednesday',
        companyId: 'acct-test',
        createdAt: 't',
        updatedAt: 't',
        resourceId: 'r2',
        startDate: '2026-06-03',
        endDate: '2026-06-03',
        type: 'holiday',
        note: null,
      },
    );

    const model = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: capacityOver(
        { from: start, to: end },
        {
          r1: { byDate: { '2026-06-02': { allocated: 4, available: 0, over: true } } },
          r2: { byDate: { '2026-06-03': { available: 0 } } },
        },
      ),
      filters: buildEmptyFilters(),
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });
    const rows = model.flatMap((group) => group.rows);
    const r1 = requireValue(
      rows.find((row) => row.resource.id === 'r1'),
      'r1 scheduler row',
    );
    const r2 = requireValue(
      rows.find((row) => row.resource.id === 'r2'),
      'r2 scheduler row',
    );

    expect(r1.dayStates.map((state) => state.over)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(r1.dayStates.map((state) => state.timeOffConflict)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(r1.timeOff).toHaveLength(1);
    expect(r2.dayStates[2]).toMatchObject({
      unavailable: true,
      over: false,
      timeOffConflict: false,
    });
  });
  it('marks only block/time-off overlaps without adding load or treating non-working days as conflicts', () => {
    const { r1, r2 } = buildBlockTimeOffRows();

    expect(r1.dayStates.map((state) => state.over)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(r1.dayStates.map((state) => state.timeOffConflict)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(r1.dayStates[4]).toMatchObject({ unavailable: true, timeOffConflict: false });
    expect(r1.dayStates[5]).toMatchObject({ unavailable: true, timeOffConflict: false });
    expect(r1.utilisation).toBe(0);
    expect(r1.overSoon).toBe(false);
    expect(r2.dayStates[2]).toMatchObject({
      unavailable: true,
      over: false,
      timeOffConflict: false,
    });
  });
});
