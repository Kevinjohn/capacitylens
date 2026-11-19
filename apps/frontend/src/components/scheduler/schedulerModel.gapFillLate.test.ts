import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { describe, expect, it } from 'vitest';
import { buildEmptyFilters } from '@/store/useStore';
import { requireValue } from '@/test/fixtures';
import { capacityOver } from '@/test/capacityFixtures';
import { buildSchedulerModel } from './schedulerModel';
import {
  makeDataset,
  days,
  end,
  geom,
  start,
  makeDatasetWithExternal,
} from './schedulerModel.testSupport';

describe('buildSchedulerModel — mutation-testing gap-fill', () => {
  it('positions overlapping bars on the SAME resource at DIFFERENT lane tops (laneById is a real Map, not empty)', () => {
    const d = makeDataset();

    d.allocations.push({
      ...NULLABLE_FIELDS.allocations,
      id: 'a-overlap',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: 'r1',
      activityId: 't1',
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      hoursPerDay: 8,
      status: 'confirmed',
    });
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
    const r1bars = requireValue(
      model.flatMap((g) => g.rows).find((r) => r.resource.id === 'r1'),
      'r1 scheduler row',
    ).bars;
    const tops = new Set(
      r1bars
        .filter((b) => b.allocation.id === 'a1' || b.allocation.id === 'a-overlap')
        .map((b) => b.top),
    );
    expect(tops.size).toBe(2);
  });
  it('overSoon truly SKIPS external resources — even one with real over-capacity hours', () => {
    const d = makeDatasetWithExternal();
    // Book the external above normal person capacity so missing capacity exclusion changes the result.
    d.allocations.push({
      ...NULLABLE_FIELDS.allocations,
      id: 'aext2',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: 'ext1',
      activityId: 't1',
      startDate: '2026-06-01',
      endDate: '2026-06-01',
      hoursPerDay: 20,
      status: 'confirmed',
    });
    // Even a capacity entry for the external partner draws no overSoon.
    const model = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: capacityOver({ from: start, to: end }, { ext1: { overSoon: true } }),
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const externalGroup = requireValue(model.at(-1), 'external group');
    expect(requireValue(externalGroup.rows[0], 'external group row').overSoon).toBe(false);
  });
});
