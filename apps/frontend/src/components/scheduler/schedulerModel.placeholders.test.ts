import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { describe, it, expect } from 'vitest';
import { buildSchedulerModel } from './schedulerModel';
import { buildEmptyFilters } from '@/store/useStore';
import type { AppData } from '@capacitylens/shared/types/entities';
import { makeResource, requireValue } from '@/test/fixtures';
import { capacityOver } from '@/test/capacityFixtures';
import {
  listAllBars,
  makeDataset,
  days,
  end,
  geom,
  makeDisciplines,
  start,
} from './schedulerModel.testSupport';

const dataset = () => makeDataset(makeDisciplines());

function buildPlaceholderData(): AppData {
  const d = dataset();
  d.resources.push(
    makeResource({
      id: 'ph',
      companyId: 'acct-test',
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
    companyId: 'acct-test',
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
        companyId: 'acct-test',
        kind: 'placeholder',
        role: 'Designer',
        disciplineId: 'd-design',
        color: '#9',
      }),
      ...d.resources,
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
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: false,
        externalEnabled: true,
      },
    });
    const ids = off.flatMap((g) => g.rows).map((r) => r.resource.id);
    expect(ids).not.toContain('ph');

    expect(listAllBars(off).map((b) => b.allocation.id)).not.toContain('a-ph');
  });

  it('placeholdersEnabled ON shows the placeholder row with its bar', () => {
    const on = buildSchedulerModel({
      data: withPlaceholder(),
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
    const ids = on.flatMap((g) => g.rows).map((r) => r.resource.id);
    expect(ids).toContain('ph');
    expect(listAllBars(on).map((b) => b.allocation.id)).toContain('a-ph');
  });

  it('placeholdersEnabled OFF excludes placeholders from per-discipline utilisation', () => {
    // Hidden placeholders must not contribute to group utilisation because averages use only modeled capacity rows.
    // The server reports the placeholder fully booked and r1 idle.
    const capacity = capacityOver(
      { from: start, to: end },
      { ph: { fill: { allocated: 8 } }, r1: {} },
    );
    const off = buildSchedulerModel({
      data: withPlaceholder(),
      geom,
      days,
      visibleWindow: { start, end },
      capacity,
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: false,
        externalEnabled: true,
      },
    });
    const on = buildSchedulerModel({
      data: withPlaceholder(),
      geom,
      days,
      visibleWindow: { start, end },
      capacity,
      filters: buildEmptyFilters(),
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    const avg = (rows: { utilisation: number }[]) =>
      rows.reduce((s, r) => s + r.utilisation, 0) / rows.length;
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
