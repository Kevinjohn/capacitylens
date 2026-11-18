import type { AppData } from '@capacitylens/shared/types/entities';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { eachDayISO } from '@capacitylens/shared/lib/dateMath';
import type { CapacitySection } from '@capacitylens/shared/lib/capacity';
import { buildEmptyFilters } from '@/store/useStore';
import {
  makeActivity,
  makeAllocation,
  makeClient,
  makeProject,
  makeResource,
} from '@/test/fixtures';
import { buildColumnGeometry } from './columnGeometry';
import { buildSchedulerModel } from './schedulerModel';
import type { GroupModel } from './schedulerModel';

interface SchedulerModelTestInput {
  filters?: ReturnType<typeof buildEmptyFilters> | undefined;
  disciplinesEnabled?: boolean | undefined;
  placeholdersEnabled?: boolean | undefined;
  externalEnabled?: boolean | undefined;
  capacity?: CapacitySection | null | undefined;
}

/** Start of the fixed model-test week. */
export const start = '2026-06-01';
/** End of the fixed model-test week. */
export const end = '2026-06-07';
/** Dates in the fixed model-test week. */
export const days = eachDayISO(start, end);
/** Uniform column geometry for the fixed model-test week. */
export const geom = buildColumnGeometry(days, 48, { minimiseWeekends: false, weekendWidth: 22 });

function makeDefaultDisciplines(): AppData['disciplines'] {
  return [
    {
      ...NULLABLE_FIELDS.disciplines,
      id: 'd-design',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Design',
      sortOrder: 0,
    },
    {
      ...NULLABLE_FIELDS.disciplines,
      id: 'd-dev',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Development',
      sortOrder: 1,
    },
  ];
}

/** Builds scoped scheduler fixtures with optional discipline overrides. */
export function dataset(disciplines: AppData['disciplines'] = makeDefaultDisciplines()): AppData {
  return {
    ...emptyAppData(),
    disciplines,
    clients: [makeClient({ companyId: 'acct-test', name: 'Ferris', color: '#1' })],
    projects: [
      makeProject({ companyId: 'acct-test', name: 'P1', color: '#2' }),
      makeProject({ id: 'p2', companyId: 'acct-test', name: 'P2', color: '#3' }),
    ],
    activities: [
      makeActivity({ companyId: 'acct-test', name: 'T1' }),
      makeActivity({ id: 't2', companyId: 'acct-test', name: 'T2', projectId: 'p2' }),
    ],
    resources: [
      makeResource({
        id: 'r1',
        companyId: 'acct-test',
        name: 'Designer Dana',
        role: 'Designer',
        disciplineId: 'd-design',
        color: '#4',
      }),
      makeResource({
        id: 'r2',
        companyId: 'acct-test',
        name: 'Dev Sam',
        role: 'Developer',
        disciplineId: 'd-dev',
        color: '#5',
      }),
    ],
    allocations: [
      makeAllocation({ companyId: 'acct-test' }),
      makeAllocation({
        id: 'a2',
        companyId: 'acct-test',
        activityId: 't2',
        startDate: '2026-06-03',
        endDate: '2026-06-04',
        hoursPerDay: 4,
        status: 'tentative',
      }),
      makeAllocation({ id: 'a3', companyId: 'acct-test', resourceId: 'r2', activityId: 't2' }),
    ],
    timeOff: [],
  };
}

/** Builds a scheduler model from the test fixture and chosen filters. */
export const build = ({
  filters = buildEmptyFilters(),
  disciplinesEnabled = true,
  placeholdersEnabled = true,
  externalEnabled = true,
  capacity = null,
}: SchedulerModelTestInput = {}) =>
  buildSchedulerModel({
    data: dataset(),
    geom,
    days,
    visibleWindow: { start, end },
    capacity,
    filters,
    preferences: { disciplinesEnabled, placeholdersEnabled, externalEnabled },
  });
/** Flattens every group and row into the modeled bar list. */
export const allBars = (model: GroupModel[]) =>
  model.flatMap((group) => group.rows).flatMap((row) => row.bars);

/** Adds an external resource to the standard scheduler fixture. */
export function withExternal(): AppData {
  const data = dataset();
  data.resources.push(
    makeResource({
      id: 'ext1',
      companyId: 'acct-test',
      kind: 'external',
      name: 'Kord Industries',
      role: 'Partner studio',
      color: '#9ca3af',
    }),
  );
  data.allocations.push({
    ...NULLABLE_FIELDS.allocations,
    id: 'aext',
    companyId: 'acct-test',
    createdAt: 't',
    updatedAt: 't',
    resourceId: 'ext1',
    activityId: 't1',
    startDate: '2026-06-05',
    endDate: '2026-06-07',
    hoursPerDay: 0,
    status: 'confirmed',
  });
  data.timeOff.push({
    ...NULLABLE_FIELDS.timeOff,
    id: 'toext',
    companyId: 'acct-test',
    createdAt: 't',
    updatedAt: 't',
    resourceId: 'ext1',
    startDate: '2026-06-02',
    endDate: '2026-06-03',
    type: 'holiday',
  });
  return data;
}

export function makeDisciplines(): AppData['disciplines'] {
  return [
    {
      id: 'd-design',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Design',
      sortOrder: 0,
      color: null,
    },
    {
      id: 'd-dev',
      companyId: 'acct-test',
      createdAt: 't',
      updatedAt: 't',
      name: 'Development',
      sortOrder: 1,
      color: null,
    },
  ];
}

export const barIds = (model: GroupModel[]) =>
  allBars(model)
    .map((b) => b.allocation.id)
    .sort();
