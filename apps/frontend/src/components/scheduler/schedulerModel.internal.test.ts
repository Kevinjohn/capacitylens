import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { describe, it, expect } from 'vitest';
import { buildSchedulerModel } from './schedulerModel';
import type { GroupModel } from './schedulerModel';
import { buildEmptyFilters } from '@/store/useStore';
import type { AppData } from '@capacitylens/shared/types/entities';
import { makeActivity, makeAllocation, makeClient, makeProject } from '@/test/fixtures';
import {
  allBars,
  barIds,
  dataset as buildDataset,
  days,
  end,
  geom,
  makeDisciplines,
  start,
} from './schedulerModel.testSupport';

const dataset = () => buildDataset(makeDisciplines());

// The Internal client filter includes both its own project activities and project-less internal work, whose client identity is derived.
function withInternal(): AppData {
  const d = dataset();
  d.clients.push(
    makeClient({
      id: 'c-internal',
      companyId: 'acct-test',
      name: 'Internal',
      color: '#9c3ace',
      builtin: true,
    }),
  );

  d.projects.push(
    makeProject({
      id: 'pInt',
      companyId: 'acct-test',
      name: 'Internal Project',
      clientId: 'c-internal',
      color: '#6',
    }),
  );
  d.activities.push(
    makeActivity({
      id: 'tIntProj',
      companyId: 'acct-test',
      name: 'Internal Proj Activity',
      projectId: 'pInt',
    }),
  );

  d.activities.push({
    ...NULLABLE_FIELDS.activities,
    id: 'tIntNoProj',
    companyId: 'acct-test',
    createdAt: 't',
    updatedAt: 't',
    name: 'Admin',
    kind: 'internal',
  });

  d.allocations.push(
    makeAllocation({
      id: 'aIntProj',
      companyId: 'acct-test',
      activityId: 'tIntProj',
      hoursPerDay: 4,
    }),
    makeAllocation({
      id: 'aIntNoProj',
      companyId: 'acct-test',
      activityId: 'tIntNoProj',
      startDate: '2026-06-03',
      endDate: '2026-06-04',
      hoursPerDay: 4,
    }),
  );
  return d;
}

function withAttributedRepeatable(): AppData {
  const d = withInternal();
  d.activities.push({
    ...NULLABLE_FIELDS.activities,
    id: 'tRep',
    companyId: 'acct-test',
    createdAt: 't',
    updatedAt: 't',
    name: 'Design',
    kind: 'repeatable',
  });
  d.allocations.push(
    {
      ...NULLABLE_FIELDS.allocations,
      id: 'aRepAttributed',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: 'r2',
      activityId: 'tRep',
      projectId: 'p1',
      startDate: '2026-06-03',
      endDate: '2026-06-03',
      hoursPerDay: 4,
      status: 'confirmed',
    },
    {
      ...NULLABLE_FIELDS.allocations,
      id: 'aRepUnattributed',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: 'r2',
      activityId: 'tRep',
      startDate: '2026-06-04',
      endDate: '2026-06-04',
      hoursPerDay: 4,
      status: 'confirmed',
    },
  );
  return d;
}

describe('repeatable allocation effective project', () => {
  const buildAttributed = (filters = buildEmptyFilters()) =>
    buildSchedulerModel({
      data: withAttributedRepeatable(),
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters,
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });

  it('labels and colours attributed work by its project while preserving the unattributed fallback', () => {
    const bars = allBars(buildAttributed());
    expect(bars.find((bar) => bar.allocation.id === 'aRepAttributed')).toMatchObject({
      project: 'P1',
      client: 'Ferris',
      color: '#2',
    });
    const unattributed = bars.find((bar) => bar.allocation.id === 'aRepUnattributed');
    expect(unattributed).toBeDefined();
    expect(unattributed).not.toHaveProperty('project');
    expect(unattributed).toMatchObject({
      client: 'Internal',
      color: '#5',
    });
  });

  it('matches attributed work through either project/client lenses or its activity lens', () => {
    const projectBars = barIds(buildAttributed({ ...buildEmptyFilters(), projectId: 'p1' }));
    const clientBars = barIds(buildAttributed({ ...buildEmptyFilters(), clientId: 'c1' }));
    const activityBars = barIds(buildAttributed({ ...buildEmptyFilters(), activityId: 'tRep' }));

    expect(projectBars).toContain('aRepAttributed');
    expect(clientBars).toContain('aRepAttributed');
    expect(activityBars).toEqual(['aRepAttributed', 'aRepUnattributed']);
    expect(projectBars).not.toContain('aRepUnattributed');
    expect(clientBars).not.toContain('aRepUnattributed');
  });
});

type BuildDanglingOptions = { filters?: ReturnType<typeof buildEmptyFilters> };
describe('built-in Internal client bucketing + filter', () => {
  const internalId = 'c-internal';

  const buildInternal = (filters = buildEmptyFilters()) =>
    buildSchedulerModel({
      data: withInternal(),
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters,
      preferences: {
        disciplinesEnabled: true,
        placeholdersEnabled: true,
        externalEnabled: true,
      },
    });

  const internalBarIds = (m: GroupModel[]) =>
    m
      .flatMap((g) => g.rows)
      .flatMap((r) => r.bars)
      .map((b) => b.allocation.id)
      .sort();

  it('filtering by the Internal client shows BOTH the project-less activity AND the Internal-owned project activity', () => {
    const model = buildInternal({ ...buildEmptyFilters(), clientId: internalId });

    expect(internalBarIds(model)).toEqual(['aIntNoProj', 'aIntProj']);
  });

  it('a project-less activity is NOT shown when filtering by a different (non-Internal) client', () => {
    const model = buildInternal({ ...buildEmptyFilters(), clientId: 'c1' });

    expect(internalBarIds(model)).not.toContain('aIntNoProj');
    expect(internalBarIds(model)).not.toContain('aIntProj');
  });

  it('does not misclassify an activity with a dangling project reference as project-less Internal work', () => {
    const data = withInternal();
    data.projects = data.projects.filter((project) => project.id !== 'pInt');
    const model = buildSchedulerModel({
      data,
      geom,
      days,
      visibleWindow: { start, end },
      capacity: null,
      filters: { ...buildEmptyFilters(), clientId: internalId },
      preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
    });

    expect(internalBarIds(model)).not.toContain('aIntProj');
  });

  it('does not bucket an unattributed dangling-activity allocation under any client or project', () => {
    const data = withInternal();
    data.allocations.push(
      {
        ...NULLABLE_FIELDS.allocations,
        id: 'dangling-unattributed',
        companyId: 'acct-test',
        createdAt: 't',
        updatedAt: 't',
        resourceId: 'r1',
        activityId: 'missing-activity',
        startDate: '2026-06-05',
        endDate: '2026-06-05',
        hoursPerDay: 2,
        status: 'confirmed',
      },
      {
        ...NULLABLE_FIELDS.allocations,
        id: 'dangling-attributed',
        companyId: 'acct-test',
        createdAt: 't',
        updatedAt: 't',
        resourceId: 'r1',
        activityId: 'missing-activity',
        projectId: 'p1',
        startDate: '2026-06-05',
        endDate: '2026-06-05',
        hoursPerDay: 2,
        status: 'confirmed',
      },
    );
    const buildDangling = ({ filters = buildEmptyFilters() }: BuildDanglingOptions = {}) =>
      buildSchedulerModel({
        data,
        geom,
        days,
        visibleWindow: { start, end },
        capacity: null,
        filters,
        preferences: {
          disciplinesEnabled: true,
          placeholdersEnabled: true,
          externalEnabled: true,
        },
      });

    expect(
      barIds(buildDangling({ filters: { ...buildEmptyFilters(), clientId: internalId } })),
    ).not.toContain('dangling-unattributed');
    expect(
      barIds(buildDangling({ filters: { ...buildEmptyFilters(), clientId: 'c1' } })),
    ).not.toContain('dangling-unattributed');
    expect(
      barIds(buildDangling({ filters: { ...buildEmptyFilters(), projectId: 'p1' } })),
    ).not.toContain('dangling-unattributed');
    expect(barIds(buildDangling({ filters: buildEmptyFilters() }))).toContain(
      'dangling-unattributed',
    );
    expect(
      barIds(buildDangling({ filters: { ...buildEmptyFilters(), clientId: 'c1' } })),
    ).toContain('dangling-attributed');
    expect(
      barIds(buildDangling({ filters: { ...buildEmptyFilters(), projectId: 'p1' } })),
    ).toContain('dangling-attributed');
  });
});

function buildInternalAndRepeatableData(): AppData {
  const d = withInternal();
  d.activities.push({
    ...NULLABLE_FIELDS.activities,
    id: 'tRep',
    companyId: 'acct-test',
    createdAt: 't',
    updatedAt: 't',
    name: 'Design',
    kind: 'repeatable',
  });
  d.allocations.push(
    {
      ...NULLABLE_FIELDS.allocations,
      id: 'aRep',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: 'r1',
      activityId: 'tRep',
      startDate: '2026-06-05',
      endDate: '2026-06-05',
      hoursPerDay: 4,
      status: 'confirmed',
    },
    {
      ...NULLABLE_FIELDS.allocations,
      id: 'aRepAttributedInternal',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      resourceId: 'r1',
      activityId: 'tRep',
      projectId: 'pInt',
      startDate: '2026-06-05',
      endDate: '2026-06-05',
      hoursPerDay: 2,
      status: 'confirmed',
    },
  );
  return d;
}

describe('internal-work bars', () => {
  it('shows every internal and all-projects bar alongside ordinary work', () => {
    const ids = barIds(
      buildSchedulerModel({
        data: buildInternalAndRepeatableData(),
        geom,
        days,
        visibleWindow: { start, end },
        capacity: null,
        filters: buildEmptyFilters(),
        preferences: { disciplinesEnabled: true, placeholdersEnabled: true, externalEnabled: true },
      }),
    );
    for (const id of ['aIntProj', 'aIntNoProj', 'aRep', 'aRepAttributedInternal', 'a1']) {
      expect(ids).toContain(id);
    }
  });
});
