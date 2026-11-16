import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { describe, it, expect } from 'vitest';
import { buildSchedulerModel } from './schedulerModel';
import { buildEmptyFilters } from '@/store/useStore';
import type { AppData } from '@capacitylens/shared/types/entities';
import { makeResource, requireValue } from '@/test/fixtures';
import {
  allBars,
  dataset as buildDataset,
  days,
  end,
  geom,
  makeDisciplines,
  start,
} from './schedulerModel.testSupport';

const dataset = () => buildDataset(makeDisciplines());

function buildPlaceholderData(): AppData {
  const d = dataset();
  d.resources.push(
    makeResource({
      id: 'ph',
      accountId: 'acct-test',
      kind: 'placeholder',
      role: 'Designer',
      disciplineId: 'd-design',
      color: '#9',
      projectId: 'p1',
    }),
  );
  d.allocations.push({
    ...NULLABLE_FIELDS.allocations,
    id: 'a-ph',
    accountId: 'acct-test',
    createdAt: 't',
    updatedAt: 't',
    resourceId: 'ph',
    activityId: 't1',
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    hoursPerDay: 8,
    status: 'confirmed',
  });
  return d;
}

describe('buildSchedulerModel', () => {
  it('orders people before placeholders within a discipline (regardless of data order)', () => {
    const d = dataset();

    d.resources = [
      makeResource({
        id: 'ph',
        accountId: 'acct-test',
        kind: 'placeholder',
        role: 'Designer',
        disciplineId: 'd-design',
        color: '#9',
      }),
      ...d.resources,
    ];
    const model = buildSchedulerModel({
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
    const design = requireValue(
      model.find((g) => g.title === 'Design'),
      'Design group',
    );
    expect(design.rows.map((r) => r.resource.id)).toEqual(['r1', 'ph']);
  });

  const withPlaceholder: () => AppData = buildPlaceholderData;
  it('placeholdersEnabled OFF hides placeholder rows + their bars across the model', () => {
    const off = buildSchedulerModel({
      data: withPlaceholder(),
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: false,
        externalEnabled: true,
      },
    });
    const ids = off.flatMap((g) => g.rows).map((r) => r.resource.id);
    expect(ids).not.toContain('ph');

    expect(allBars(off).map((b) => b.allocation.id)).not.toContain('a-ph');
  });

  it('placeholdersEnabled ON shows the placeholder row with its bar', () => {
    const on = buildSchedulerModel({
      data: withPlaceholder(),
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
    const ids = on.flatMap((g) => g.rows).map((r) => r.resource.id);
    expect(ids).toContain('ph');
    expect(allBars(on).map((b) => b.allocation.id)).toContain('a-ph');
  });

  it('placeholdersEnabled OFF excludes placeholders from per-discipline utilisation', () => {
    // Hidden placeholders must not contribute to group utilisation because averages use only modeled capacity rows.
    const off = buildSchedulerModel({
      data: withPlaceholder(),
      geom: geom,
      days: days,
      visibleWindow: { start: start, end: end },
      overSoonWindow: { start: start, end: end },
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: false,
        externalEnabled: true,
      },
    });
    const on = buildSchedulerModel({
      data: withPlaceholder(),
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
    const avg = (rows: { utilization: number }[]) =>
      rows.reduce((s, r) => s + r.utilization, 0) / rows.length;
    const designOff = requireValue(
      off.find((g) => g.title === 'Design'),
      'Design group with placeholders hidden',
    );
    const designOn = requireValue(
      on.find((g) => g.title === 'Design'),
      'Design group with placeholders shown',
    );

    expect(avg(designOn.rows)).toBeGreaterThan(avg(designOff.rows));

    expect(designOff.rows.map((r) => r.resource.id)).toEqual(['r1']);
  });
});
