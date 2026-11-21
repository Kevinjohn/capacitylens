import { describe, it, expect } from 'vitest';
import { buildSchedulerModel } from './schedulerModel';
import { buildEmptyFilters } from '@/store/useStore';
import type { AppData } from '@capacitylens/shared/types/entities';
import { requireValue } from '@/test/fixtures';
import {
  listBarIds,
  build,
  makeDataset,
  days,
  end,
  geom,
  makeDisciplines,
  start,
  makeDatasetWithExternal,
} from './schedulerModelTestKit';

const dataset = () => makeDataset(makeDisciplines());

function makeEngagementOrderingData(): AppData {
  const data = dataset();
  const designTemplate = requireValue(data.resources[0], 'design resource template');
  data.resources = [
    { ...designTemplate, id: 'design-alpha', name: 'Alpha' },
    {
      ...designTemplate,
      id: 'design-zulu',
      name: 'Zulu',
      engagement: 'supplementary',
      isFavourite: true,
    },
    { ...designTemplate, id: 'design-beta', name: 'Beta', isFavourite: true },
    {
      ...designTemplate,
      id: 'design-gamma',
      name: 'Gamma',
      engagement: 'supplementary',
    },
    requireValue(data.resources[1], 'development resource'),
    {
      ...designTemplate,
      id: 'external-alpha',
      kind: 'external',
      name: 'Ferris',
      role: 'Print',
    },
    {
      ...designTemplate,
      id: 'external-zulu',
      kind: 'external',
      name: 'Zeta',
      role: 'Studio',
      isFavourite: true,
    },
  ];
  return data;
}

it('keeps discipline groups while ordering engagement partitions and externals deterministically', () => {
  const data = makeEngagementOrderingData();

  const model = buildSchedulerModel({
    data,
    geom,
    days,
    visibleWindow: { start, end },
    capacity: null,
    filters: buildEmptyFilters(),
    preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
  });

  expect(model.map((group) => group.key)).toEqual(['d-design', 'd-dev', 'external']);
  expect(requireValue(model[0], 'design group').rows.map((row) => row.resource.name)).toEqual([
    'Beta',
    'Alpha',
    'Zulu',
    'Gamma',
  ]);
  expect(requireValue(model[2], 'external group').rows.map((row) => row.resource.name)).toEqual([
    'Zeta',
    'Ferris',
  ]);

  const studioOnly = {
    ...data,
    resources: data.resources.map((resource) => ({ ...resource, engagement: 'studio' as const })),
  };
  const ungroupedByEngagement = buildSchedulerModel({
    data: studioOnly,
    geom,
    days,
    visibleWindow: { start, end },
    capacity: null,
    filters: buildEmptyFilters(),
    preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
  });
  expect(
    requireValue(ungroupedByEngagement[0], 'ungrouped design group').rows.map(
      (row) => row.resource.name,
    ),
  ).toEqual(['Beta', 'Zulu', 'Alpha', 'Gamma']);
});

describe('buildSchedulerModel', () => {
  it('disciplines off → a Studio-only company is one flat Resources band', () => {
    const model = build({ filters: buildEmptyFilters(), disciplinesEnabled: false });
    expect(model).toHaveLength(1);
    expect(model[0]).toMatchObject({ key: 'resources', title: 'Resources' });
    expect(model[0]?.rows.map((r) => r.resource.id).sort()).toEqual(['r1', 'r2']);
    expect(model[0]).not.toHaveProperty('color');
    expect(listBarIds(model)).toEqual(['a1', 'a2', 'a3']);
  });

  it('disciplines off → one Supplementary person splits the company into Studio then Supplementary', () => {
    const data = dataset();
    data.resources = data.resources.map((resource) =>
      resource.id === 'r2' ? { ...resource, engagement: 'supplementary' as const } : resource,
    );
    const model = buildSchedulerModel({
      data,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: buildEmptyFilters(),
      preferences: { disciplinesEnabled: false, placeholdersEnabled: true, externalEnabled: true },
    });
    expect(model.map((group) => group.key)).toEqual([
      'engagement-studio',
      'engagement-supplementary',
    ]);
    expect(model.map((group) => group.rows.map((row) => row.resource.id))).toEqual([
      ['r1'],
      ['r2'],
    ]);
  });

  it('disciplines off → the discipline filter is ignored (everyone still shown)', () => {
    const model = build({
      filters: { ...buildEmptyFilters(), disciplineId: 'd-dev' },
      disciplinesEnabled: false,
    });
    expect(model).toHaveLength(1);
    expect(model[0]?.title).toBe('Resources');
    expect(model[0]?.rows.map((r) => r.resource.id).sort()).toEqual(['r1', 'r2']);
  });
});

type BuildExtOptions = {
  filters?: ReturnType<typeof buildEmptyFilters>;
  disciplinesEnabled?: boolean;
  externalEnabled?: boolean;
};
describe('external / 3rd-party band', () => {
  const buildExt = ({
    filters = buildEmptyFilters(),
    disciplinesEnabled = true,
    externalEnabled = true,
  }: BuildExtOptions = {}) =>
    buildSchedulerModel({
      data: makeDatasetWithExternal(),
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters,
      preferences: {
        disciplinesEnabled,
        placeholdersEnabled: true,
        externalEnabled,
      },
    });

  it('renders external resources in a neutral band that is ALWAYS last', () => {
    const model = buildExt();

    expect(model.map((g) => g.key)).toEqual(['d-design', 'd-dev', 'external']);
    const last = model[model.length - 1];
    expect(last).toBeDefined();
    if (!last) throw new Error('Expected the external resource group.');
    expect(last.title).toBe('External / 3rd party');

    expect(last.color).toBe('#9ca3af');
    expect(last.rows.map((r) => r.resource.id)).toEqual(['ext1']);
  });

  it('external rows carry no capacity while company-closed dates remain visibly blocked', () => {
    const ext = buildExt().at(-1)?.rows[0];
    expect(ext).toBeDefined();
    if (!ext) throw new Error('Expected the external resource row.');
    expect(ext.utilisation).toBe(0);
    expect(ext.overSoon).toBe(false);
    expect(ext.dayStates.every((d) => !d.over)).toBe(true);
    expect(ext.dayStates.every((d) => !d.partialCapacity)).toBe(true);
    expect(ext.dayStates.map((d) => d.unavailable)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(ext.timeOff).toEqual([]);
  });

  it('external parties are still assignable — their activity bars still render', () => {
    const ext = buildExt().at(-1)?.rows[0];
    expect(ext).toBeDefined();
    if (!ext) throw new Error('Expected the external resource row.');
    expect(ext.bars.map((b) => b.allocation.id)).toEqual(['aext']);
  });

  it('disciplines off → external STILL forms its own trailing band after the people', () => {
    const model = buildExt({ disciplinesEnabled: false });

    expect(model).toHaveLength(2);
    expect(model[0]?.title).toBe('Resources');
    expect(model[0]?.rows.map((r) => r.resource.id).sort()).toEqual(['r1', 'r2']);
    expect(model[1]?.key).toBe('external');
    expect(model[1]?.rows.map((r) => r.resource.id)).toEqual(['ext1']);
  });

  it('externalEnabled OFF hides external rows + their bars across the model', () => {
    const off = buildExt({ disciplinesEnabled: true, externalEnabled: false });
    const ids = off.flatMap((g) => g.rows).map((r) => r.resource.id);
    expect(ids).not.toContain('ext1');

    expect(
      off
        .flatMap((g) => g.rows)
        .flatMap((r) => r.bars)
        .map((b) => b.allocation.id),
    ).not.toContain('aext');
  });

  it('externalEnabled OFF drops the (now-empty) External band header entirely (risk #2)', () => {
    const off = buildExt({ disciplinesEnabled: true, externalEnabled: false });
    expect(off.map((g) => g.key)).not.toContain('external');

    const offFlat = buildExt({ disciplinesEnabled: false, externalEnabled: false });
    expect(offFlat.map((g) => g.key)).not.toContain('external');
    expect(offFlat).toHaveLength(1);
  });

  it('externalEnabled ON shows the external row with its bar', () => {
    const on = buildExt({ disciplinesEnabled: true, externalEnabled: true });
    expect(on.map((g) => g.key)).toContain('external');
    const ext = on.at(-1)?.rows[0];
    expect(ext).toBeDefined();
    if (!ext) throw new Error('Expected the external resource row.');
    expect(ext.resource.id).toBe('ext1');
    expect(ext.bars.map((b) => b.allocation.id)).toEqual(['aext']);
  });
});

it('uses a neutral unassigned scheduler band while preserving stored resource colour', () => {
  const d = dataset();
  const template = requireValue(d.resources[0], 'resource template');
  d.resources = [{ ...template, id: 'unassigned', disciplineId: null, color: '#2d75da' }];
  const model = buildSchedulerModel({
    data: d,
    geom,
    days,
    visibleWindow: { start, end },
    capacity: null,
    filters: buildEmptyFilters(),
    preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
  });
  const group = model.find((g) => g.rows.some((r) => r.resource.id === 'unassigned'));
  expect(group?.color).toBe('#9ca3af');
  expect(d.resources[0]?.color).toBe('#2d75da');
});
