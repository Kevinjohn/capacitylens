import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { describe, expect, it } from 'vitest';
import type { AppData } from '@capacitylens/shared/types/entities';
import { buildEmptyFilters } from '@/store/useStore';
import { makeResource, requireValue } from '@/test/fixtures';
import { capacityOver } from '@/test/capacityFixtures';
import { buildSchedulerModel } from './schedulerModel';
import type { GroupModel } from './schedulerModel';
import {
  listAllBars,
  makeDataset,
  days,
  end,
  geom,
  start,
  makeDatasetWithExternal,
} from './schedulerModelTestKit';

function buildDanglingActivityData() {
  const d = makeDataset();
  d.allocations.push({
    ...NULLABLE_FIELDS.allocations,
    id: 'a-ghost2',
    companyId: 'acct-test',
    createdAt: 't',
    updatedAt: 't',
    resourceId: 'r1',
    activityId: 'ghost-activity-2',
    startDate: '2026-06-05',
    endDate: '2026-06-05',
    hoursPerDay: 8,
    status: 'confirmed',
  });
  return d;
}

function assertDanglingActivityFiltersDoNotThrow(d: AppData) {
  expect(() =>
    buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: { ...buildEmptyFilters(), projectId: 'p1' },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    }),
  ).not.toThrow();
  expect(() =>
    buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: { ...buildEmptyFilters(), clientId: 'c1' },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    }),
  ).not.toThrow();
  expect(() =>
    buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: { ...buildEmptyFilters(), activityKind: 'internal' },
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    }),
  ).not.toThrow();
}

function buildDanglingActivityModel(d: AppData) {
  const model = buildSchedulerModel({
    data: d,
    geom,
    days,
    visibleWindow: { start, end },
    capacity: null,
    filters: { ...buildEmptyFilters(), projectId: 'p1' },
    preferences: {
      disciplinesEnabled: true,
      placeholdersEnabled: true,
      externalEnabled: true,
    },
  });
  return model;
}

function buildCompanyClosureData(): AppData {
  const d = makeDatasetWithExternal();
  d.resources.push(
    makeResource({
      id: 'placeholder-1',
      companyId: 'acct-test',
      kind: 'placeholder',
      name: 'Design placeholder',
      role: 'Designer',
      disciplineId: 'd-design',
    }),
  );
  d.allocations.push({
    ...NULLABLE_FIELDS.allocations,
    id: 'ignored-r2-saturday',
    companyId: 'acct-test',
    createdAt: 't',
    updatedAt: 't',
    resourceId: 'r2',
    activityId: 't2',
    startDate: '2026-06-06',
    endDate: '2026-06-06',
    hoursPerDay: 4,
    status: 'confirmed',
    ignoreWorkingDays: true,
  });
  d.closures.push(
    {
      id: 'company-wednesday',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Company shutdown',
      startDate: '2026-06-03',
      endDate: '2026-06-03',
    },
    {
      id: 'company-saturday',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Weekend shutdown',
      startDate: '2026-06-06',
      endDate: '2026-06-06',
    },
  );
  d.timeOff.push({
    ...NULLABLE_FIELDS.timeOff,
    id: 'personal-r1-wednesday',
    companyId: 'acct-test',
    createdAt: 't',
    updatedAt: 't',
    resourceId: 'r1',
    startDate: '2026-06-03',
    endDate: '2026-06-03',
    type: 'holiday',
  });
  return d;
}

type BuildCompanyClosureModelOptions = { blocksMode?: boolean };
function buildCompanyClosureModel({ blocksMode = false }: BuildCompanyClosureModelOptions = {}) {
  return buildSchedulerModel({
    data: buildCompanyClosureData(),
    geom,
    days,
    visibleWindow: { start, end },
    // The server's figures: Wednesday's closure leaves no capacity, and r1 is over on Wednesday and
    // r2 on Saturday.
    capacity: capacityOver(
      { from: start, to: end },
      {
        r1: {
          overSoon: true,
          byDate: {
            '2026-06-03': { allocated: 8, available: 0, over: !blocksMode, timeOffConflict: true },
          },
        },
        r2: {
          byDate: {
            '2026-06-03': { available: 0 },
            '2026-06-06': { allocated: 4, available: 0, over: true, timeOffConflict: true },
          },
        },
        'placeholder-1': { byDate: { '2026-06-03': { available: 0 } } },
      },
    ),
    filters: buildEmptyFilters(),
    preferences: {
      disciplinesEnabled: true,
      placeholdersEnabled: true,
      externalEnabled: true,
    },
  });
}

describe('buildSchedulerModel — mutation-testing gap-fill', () => {
  describe('company closures', () => {
    const companyData: () => AppData = buildCompanyClosureData;
    const buildCompany: (options?: BuildCompanyClosureModelOptions) => GroupModel[] =
      buildCompanyClosureModel;
    it('draws closure conflict cells on every tracked row from the server figures', () => {
      const rows = buildCompany().flatMap((group) => group.rows);
      const r1 = requireValue(
        rows.find((row) => row.resource.id === 'r1'),
        'r1 scheduler row',
      );
      const r2 = requireValue(
        rows.find((row) => row.resource.id === 'r2'),
        'r2 scheduler row',
      );
      const placeholder = requireValue(
        rows.find((row) => row.resource.id === 'placeholder-1'),
        'placeholder scheduler row',
      );

      expect(r1.dayStates[2]).toMatchObject({
        unavailable: true,
        hasTimeOff: true,
        over: true,
        timeOffConflict: true,
      });
      expect(r2.dayStates[2]).toMatchObject({
        unavailable: true,
        hasTimeOff: true,
        over: false,
        timeOffConflict: false,
      });
      expect(placeholder.dayStates[2]).toMatchObject({
        unavailable: true,
        hasTimeOff: true,
        over: false,
        timeOffConflict: false,
      });

      expect(r1.dayStates[5]).toMatchObject({
        hasTimeOff: true,
        over: false,
        timeOffConflict: false,
      });
      expect(r2.dayStates[5]).toMatchObject({
        hasTimeOff: true,
        over: true,
        timeOffConflict: true,
      });
      expect(r1.overSoon).toBe(true);
      expect(placeholder.overSoon).toBe(false);

      expect(r1.timeOff.map((entry) => entry.id)).toContain('personal-r1-wednesday');
      expect(r2.timeOff).toEqual([]);
      expect(companyData().closures.map((entry) => entry.id)).toContain('company-wednesday');
      expect(r1.conflictDayCount).toBe(1);
    });
    it('flags a zero-load Block overlapping a closure', () => {
      const r1 = requireValue(
        buildCompany({ blocksMode: true })
          .flatMap((group) => group.rows)
          .find((row) => row.resource.id === 'r1'),
        'r1 scheduler row',
      );

      expect(r1.dayStates[2]).toMatchObject({
        over: false,
        hasTimeOff: true,
        timeOffConflict: true,
      });
      expect(r1.conflictDayCount).toBe(1);
    });
    it('keeps external capacity starved and exempt from company closures', () => {
      const external = requireValue(
        requireValue(
          buildCompany().find((group) => group.external),
          'external group',
        ).rows[0],
        'external scheduler row',
      );

      expect(external.timeOff).toEqual([]);
      expect(external.conflictDayCount).toBe(0);
      expect(external.utilisation).toBe(0);
      expect(external.overSoon).toBe(false);
      expect(external.dayStates[2]).toMatchObject({
        creationBlocked: false,
        unavailable: false,
        hasTimeOff: false,
        over: false,
        timeOffConflict: false,
      });
    });
  });
  it('external rows use literal {over:false, unavailable:false} day-states (real booleans, not an empty object)', () => {
    const model = buildSchedulerModel({
      data: makeDatasetWithExternal(),
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
    const ext = model.at(-1)?.rows[0];
    expect(ext).toBeDefined();
    if (!ext) throw new Error('Expected the external resource row.');
    expect(ext.dayStates[0]).toEqual({
      over: false,
      timeOffConflict: false,
      unavailable: false,
      partialCapacity: false,
      creationBlocked: false,

      hasTimeOff: false,
    });
  });
  it('a dangling activityId (missing from `activities`) degrades to safe fallbacks, never throws', () => {
    const d = makeDataset();
    d.allocations.push({
      ...NULLABLE_FIELDS.allocations,
      id: 'a-ghost',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: 'r1',
      activityId: 'ghost-activity',
      startDate: '2026-06-05',
      endDate: '2026-06-05',
      hoursPerDay: 8,
      status: 'confirmed',
    });
    let model: GroupModel[] = [];
    expect(() => {
      model = buildSchedulerModel({
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
    }).not.toThrow();
    const bar = requireValue(
      listAllBars(model).find((b) => b.allocation.id === 'a-ghost'),
      'ghost allocation bar',
    );
    expect(bar.label).toBe('Activity');
    expect(bar.project).toBeUndefined();
    expect(bar.client).toBeUndefined();
  });
  it('a dangling activityId does not throw when project/client/activity-kind filters are active, and is filtered out', () => {
    const d = buildDanglingActivityData();
    assertDanglingActivityFiltersDoNotThrow(d);
    const model = buildDanglingActivityModel(d);
    expect(listAllBars(model).map((b) => b.allocation.id)).not.toContain('a-ghost2');
  });
  it('keeps assigned discipline bands before unassigned Studio, Supplementary and External bands', () => {
    const d = makeDatasetWithExternal();
    const template = requireValue(d.resources[0], 'resource template');
    const unassignedTemplate = { ...template };
    unassignedTemplate.disciplineId = null;
    d.resources.push(
      { ...unassignedTemplate, id: 'unassigned-studio', name: 'Studio Floater' },
      {
        ...unassignedTemplate,
        id: 'unassigned-supplementary',
        name: 'Supplementary Floater',
        engagement: 'supplementary',
      },
      {
        ...template,
        id: 'dangling-studio',
        name: 'Deleted Discipline',
        disciplineId: 'deleted-discipline',
      },
    );

    const model = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: buildEmptyFilters(),
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });

    expect(model.map((group) => group.title)).toEqual([
      'Design',
      'Development',
      'Studio',
      'Supplementary',
      'External / 3rd party',
    ]);
    expect(model.map((group) => group.key)).toEqual([
      'd-design',
      'd-dev',
      'engagement-studio',
      'engagement-supplementary',
      'external',
    ]);
    expect(
      requireValue(
        model.find((group) => group.title === 'Studio'),
        'Studio group',
      )
        .rows.map((row) => row.resource.id)
        .sort(),
    ).toEqual(['dangling-studio', 'unassigned-studio']);
  });
  it('uses engagement bands when no disciplines exist and ignores a stale discipline filter', () => {
    const d = makeDatasetWithExternal();
    d.disciplines = [];
    d.resources[1] = {
      ...requireValue(d.resources[1], 'second resource'),
      engagement: 'supplementary',
    };

    const model = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: { ...buildEmptyFilters(), disciplineId: 'deleted-discipline' },
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });

    expect(model.map((group) => group.title)).toEqual([
      'Studio',
      'Supplementary',
      'External / 3rd party',
    ]);
    expect(
      model
        .flatMap((group) => group.rows)
        .map((row) => row.resource.id)
        .sort(),
    ).toEqual(['ext1', 'r1', 'r2']);
  });
  it('uses engagement fallback bands when disciplines exist but nobody is assigned', () => {
    const d = makeDataset();
    d.resources = d.resources.map((resource, index) => {
      const unassignedResource = { ...resource };
      unassignedResource.disciplineId = null;
      return {
        ...unassignedResource,
        engagement: index === 0 ? 'studio' : 'supplementary',
      };
    });

    const model = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: buildEmptyFilters(),
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });

    expect(model.map((group) => group.title)).toEqual(['Studio', 'Supplementary']);
    expect(
      model
        .flatMap((group) => group.rows)
        .map((row) => row.resource.id)
        .sort(),
    ).toEqual(['r1', 'r2']);
  });
  it('does not render empty fallback bands, including an external-only schedule', () => {
    const studioOnly = makeDataset();
    studioOnly.disciplines = [];
    expect(
      buildSchedulerModel({
        data: studioOnly,
        geom,
        days,
        visibleWindow: { start, end },
        capacity: null,
        filters: buildEmptyFilters(),
        preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
      }).map((group) => group.title),
    ).toEqual(['Unassigned']);

    const externalOnly = makeDatasetWithExternal();
    externalOnly.disciplines = [];
    externalOnly.resources = externalOnly.resources.filter((resource) => resource.id === 'ext1');
    expect(
      buildSchedulerModel({
        data: externalOnly,
        geom,
        days,
        visibleWindow: { start, end },
        capacity: null,
        filters: buildEmptyFilters(),
        preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
      }).map((group) => group.title),
    ).toEqual(['External / 3rd party']);
  });
  it('uses one fallback band for a Studio-only company: Unassigned with disciplines, Resources without', () => {
    const d = makeDatasetWithExternal();
    const firstResource = d.resources[0];
    expect(firstResource).toBeDefined();
    if (!firstResource) throw new Error('Expected the base scheduler resource.');
    const unassignedResource = { ...firstResource };
    unassignedResource.disciplineId = null;
    d.resources[0] = unassignedResource;
    const withDisciplines = buildSchedulerModel({
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
    expect(withDisciplines.map((group) => group.title)).toEqual([
      'Development',
      'Unassigned',
      'External / 3rd party',
    ]);

    const withoutDisciplines = buildSchedulerModel({
      data: d,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: { ...buildEmptyFilters(), disciplineId: 'd-dev' },
      preferences: {
        disciplinesEnabled: false,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });
    expect(withoutDisciplines.map((group) => group.title)).toEqual([
      'Resources',
      'External / 3rd party',
    ]);
    expect(requireValue(withoutDisciplines[0], 'resources group').rows).toHaveLength(2);
  });
  it('group.external is a real boolean: true for the external band, false (not undefined) for a discipline group', () => {
    const model = buildSchedulerModel({
      data: makeDatasetWithExternal(),
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
    const externalGroup = requireValue(model.at(-1), 'external group');
    expect(design.external).toBe(false);
    expect(externalGroup.external).toBe(true);
  });
  it('placeholder ordering is stable WITHIN each kind: multiple persons keep their relative order, multiple placeholders too', () => {
    const d = makeDataset();
    d.resources = [
      makeResource({
        id: 'ph1',
        companyId: 'acct-test',
        kind: 'placeholder',
        role: 'Designer',
        disciplineId: 'd-design',
        color: '#9',
      }),
      makeResource({
        id: 'r1',
        companyId: 'acct-test',
        name: 'Dana',
        role: 'Designer',
        disciplineId: 'd-design',
        color: '#4',
      }),
      makeResource({
        id: 'ph2',
        companyId: 'acct-test',
        kind: 'placeholder',
        role: 'Designer',
        disciplineId: 'd-design',
        color: '#8',
      }),
      makeResource({
        id: 'r2',
        companyId: 'acct-test',
        name: 'Sam',
        role: 'Designer',
        disciplineId: 'd-design',
        color: '#5',
      }),
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
    expect(design.rows.map((r) => r.resource.id)).toEqual(['r1', 'r2', 'ph1', 'ph2']);
  });
});
