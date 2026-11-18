import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { describe, it, expect } from 'vitest';
import { buildSchedulerModel } from './schedulerModel';
import { buildEmptyFilters } from '@/store/useStore';
import type { AppData } from '@capacitylens/shared/types/entities';
import { requireValue } from '@/test/fixtures';
import { capacityOver } from '@/test/capacityFixtures';
import {
  barIds,
  build,
  dataset as buildDataset,
  days,
  end,
  geom,
  makeDisciplines,
  start,
} from './schedulerModel.testSupport';

const dataset = () => buildDataset(makeDisciplines());

function buildLensActivitiesData(): AppData {
  const d = dataset();
  d.activities.push(
    {
      ...NULLABLE_FIELDS.activities,
      id: 't-int',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Admin',
      kind: 'internal',
    },
    {
      ...NULLABLE_FIELDS.activities,
      id: 't-rep',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Design',
      kind: 'repeatable',
    },
  );
  d.allocations.push(
    {
      ...NULLABLE_FIELDS.allocations,
      id: 'a-int',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: 'r1',
      activityId: 't-int',
      startDate: '2026-06-05',
      endDate: '2026-06-05',
      hoursPerDay: 8,
      status: 'confirmed',
    },
    {
      ...NULLABLE_FIELDS.allocations,
      id: 'a-rep',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: 'r2',
      activityId: 't-rep',
      startDate: '2026-06-05',
      endDate: '2026-06-05',
      hoursPerDay: 8,
      status: 'confirmed',
    },
  );
  return d;
}

describe('buildSchedulerModel', () => {
  const buildLens = (filters = buildEmptyFilters()) =>
    buildSchedulerModel({
      data: buildLensActivitiesData(),
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters,
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });

  it("hideTentative removes tentative bars, but utilisation still draws the server's figures", () => {
    // The server counts the hidden tentative work: 24 of 56 hours.
    const capacity = capacityOver(
      { from: start, to: end },
      { r1: { byDate: { '2026-06-03': { allocated: 8 }, '2026-06-04': { allocated: 16 } } } },
    );
    const model = build({ filters: { ...buildEmptyFilters(), hideTentative: true }, capacity });
    expect(barIds(model)).toEqual(['a1', 'a3']);
    const r1 = requireValue(
      model.flatMap((g) => g.rows).find((r) => r.resource.id === 'r1'),
      'r1 scheduler row',
    );

    expect(r1.utilization).toBeCloseTo(24 / 56);
  });

  it('project filter limits bars to that project (resources still listed)', () => {
    expect(barIds(build({ filters: { ...buildEmptyFilters(), projectId: 'p2' } }))).toEqual([
      'a2',
      'a3',
    ]);
  });

  it('activity lens: a specific activity id limits bars to that activity', () => {
    const bars = buildLens({ ...buildEmptyFilters(), activityId: 't-rep' })
      .flatMap((g) => g.rows)
      .flatMap((r) => r.bars)
      .map((b) => b.allocation.id)
      .sort();
    expect(bars).toEqual(['a-rep']);
  });

  it('activity lens: "All projects — All" (activityKind) shows only all-projects activity allocations', () => {
    const bars = buildLens({ ...buildEmptyFilters(), activityKind: 'repeatable' })
      .flatMap((g) => g.rows)
      .flatMap((r) => r.bars)
      .map((b) => b.allocation.id)
      .sort();
    expect(bars).toEqual(['a-rep']);
  });

  it('activity lens: "Internal — All" (activityKind) shows only internal-activity allocations', () => {
    const bars = buildLens({ ...buildEmptyFilters(), activityKind: 'internal' })
      .flatMap((g) => g.rows)
      .flatMap((r) => r.bars)
      .map((b) => b.allocation.id)
      .sort();
    expect(bars).toEqual(['a-int']);
  });

  it('activity lens: dims (and by default hides) rows with no work on the filtered activity', () => {
    const rows = buildLens({
      ...buildEmptyFilters(),
      activityKind: 'repeatable',
    }).flatMap((g) => g.rows);
    expect(rows.map((r) => r.resource.id)).toEqual(['r2']);
  });

  it('dims (not hides) a resource with no work on the active project when showUnmatched is opted in', () => {
    const rows = build({
      filters: {
        ...buildEmptyFilters(),
        projectId: 'p1',
        showUnmatched: true,
      },
    }).flatMap((g) => g.rows);
    expect(
      requireValue(
        rows.find((r) => r.resource.id === 'r1'),
        'r1 scheduler row',
      ).dimmed,
    ).toBe(false);
    const r2 = requireValue(
      rows.find((r) => r.resource.id === 'r2'),
      'r2 scheduler row',
    );
    expect(r2.dimmed).toBe(true);
    expect(r2.bars.map((b) => b.allocation.id)).toEqual(['a3']);
  });

  it('hides the unmatched (unallocated) rows by default', () => {
    const rows = build({ filters: { ...buildEmptyFilters(), projectId: 'p1' } }).flatMap(
      (g) => g.rows,
    );
    expect(rows.map((r) => r.resource.id)).toEqual(['r1']);
  });

  it('does not leave a full-opacity zero-bar ghost row when the only match is a hidden tentative allocation', () => {
    // Tentative work hidden by the filter cannot count as a visible match and leave an empty full-opacity row.
    const filters = {
      ...buildEmptyFilters(),
      projectId: 'p2',
      hideTentative: true,
      showUnmatched: false,
    };
    const rows = build({ filters }).flatMap((g) => g.rows);
    expect(rows.map((r) => r.resource.id)).toEqual(['r2']);
    expect(rows.every((r) => r.dimmed || r.bars.length > 0)).toBe(true);
  });

  it('does not treat off-timeline matching work as a visible filter match', () => {
    const d = dataset();
    const offTimeline = requireValue(
      d.allocations.find((allocation) => allocation.id === 'a1'),
      'a1 allocation',
    );
    offTimeline.startDate = '2035-01-01';
    offTimeline.endDate = '2035-01-02';
    const filtered = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: { ...buildEmptyFilters(), projectId: 'p1', showUnmatched: false },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });

    expect(filtered.flatMap((group) => group.rows)).toHaveLength(0);

    const staffing = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: { ...buildEmptyFilters(), projectId: 'p1', showUnmatched: true },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const r1 = requireValue(
      staffing.flatMap((group) => group.rows).find((row) => row.resource.id === 'r1'),
      'r1 staffing row',
    );
    expect(r1.dimmed).toBe(true);
    expect(r1.bars.map((bar) => bar.allocation.id)).toEqual(['a2']);
  });

  it('dims (showing real load) a tentative-only-match row when showUnmatched is on', () => {
    const filters = {
      ...buildEmptyFilters(),
      projectId: 'p2',
      hideTentative: true,
      showUnmatched: true,
    };
    const r1 = requireValue(
      build({ filters })
        .flatMap((g) => g.rows)
        .find((r) => r.resource.id === 'r1'),
      'r1 scheduler row',
    );
    expect(r1.dimmed).toBe(true);
    expect(r1.bars.map((b) => b.allocation.id)).toEqual(['a1']);
  });

  it('discipline filter drops other groups', () => {
    const model = build({ filters: { ...buildEmptyFilters(), disciplineId: 'd-dev' } });
    expect(model.map((g) => g.title)).toEqual(['Development']);
    expect(barIds(model)).toEqual(['a3']);
  });

  it('search narrows to matching resources and drops now-empty groups', () => {
    const model = build({ filters: { ...buildEmptyFilters(), search: 'dev sam' } });
    expect(model.map((g) => g.title)).toEqual(['Development']);
  });

  it('folds resource-name diacritics and matches a phrase across field boundaries', () => {
    const d = dataset();
    const firstResource = d.resources[0];
    expect(firstResource).toBeDefined();
    if (!firstResource) throw new Error('Expected the base scheduler resource.');
    d.resources[0] = { ...firstResource, name: 'Jose\u0301 Alvarez', role: 'Research Lead' };
    const search = (query: string) =>
      buildSchedulerModel({
        data: d,
        geom,
        days,
        visibleWindow: { start, end },
        capacity: null,
        filters: { ...buildEmptyFilters(), search: query },
        preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
      })
        .flatMap((group) => group.rows)
        .map((row) => row.resource.id);

    expect(search('jose alvarez')).toContain('r1');
    expect(search('alvarez research')).toContain('r1');
    expect(search('alvarez engineer')).not.toContain('r1');
  });
});
