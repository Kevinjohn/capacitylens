import { NULLABLE_FIELDS } from '../../types/nullableFields.js';
import { emptyAppData } from '../../types/entities.js';
import type {
  Account,
  Allocation,
  AppData,
  Client,
  Discipline,
  ID,
  Phase,
  Project,
  Resource,
  Activity,
  TimeOff,
} from '../../types/entities.js';

interface ActivityOptions {
  id: ID;
  companyId: ID;
  projectId: ID;
  phaseId?: ID;
}

interface AllocationOptions {
  id: ID;
  companyId: ID;
  resourceId: ID;
  activityId: ID;
  overrides?: Partial<Allocation>;
}

interface TimeOffOptions {
  id: ID;
  companyId: ID;
  resourceId: ID;
  overrides?: Partial<TimeOff>;
}

export const TS = '2026-01-01T00:00:00.000Z';
export const makeMeta = (id: ID, companyId: ID) => ({
  id,
  companyId,
  createdAt: TS,
  updatedAt: TS,
});

export const makeAccount = (id: ID, name = 'Co'): Account => ({
  ...NULLABLE_FIELDS.accounts,
  id,
  name,
  color: '#3b82f6',
  createdAt: TS,
  updatedAt: TS,
});
export const client = (id: ID, companyId: ID, name = 'Ferris'): Client => ({
  ...NULLABLE_FIELDS.clients,
  ...makeMeta(id, companyId),
  name,
  color: '#3b82f6',
});
export const project = (id: ID, companyId: ID, clientId: ID): Project => ({
  ...NULLABLE_FIELDS.projects,
  ...makeMeta(id, companyId),
  name: 'Web',
  clientId,
  color: '#3b82f6',
});
export const phase = (id: ID, companyId: ID, projectId: ID): Phase => ({
  ...makeMeta(id, companyId),
  name: 'Discovery',
  projectId,
});
export const activity = ({ id, companyId, projectId, phaseId }: ActivityOptions): Activity => ({
  ...NULLABLE_FIELDS.activities,
  ...makeMeta(id, companyId),
  name: 'Activity',
  kind: 'project',
  projectId,
  ...(phaseId === undefined ? {} : { phaseId }),
});
export const person = (id: ID, companyId: ID): Resource => ({
  ...NULLABLE_FIELDS.resources,
  ...makeMeta(id, companyId),
  kind: 'person',
  role: 'Designer',
  employmentType: 'permanent',
  engagement: 'studio' as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: '#3b82f6',
});
export const makeDiscipline = (id: ID, companyId: ID): Discipline => ({
  ...NULLABLE_FIELDS.disciplines,
  ...makeMeta(id, companyId),
  name: 'Design',
  sortOrder: 0,
});
export const placeholder = (id: ID, companyId: ID, projectId?: ID): Resource => ({
  ...person(id, companyId),
  kind: 'placeholder',
  ...(projectId === undefined ? {} : { projectId }),
});
export const makeExternal = (id: ID, companyId: ID): Resource => ({
  ...person(id, companyId),
  kind: 'external',
});
export const allocation = ({
  id,
  companyId,
  resourceId,
  activityId,
  overrides: o = {},
}: AllocationOptions): Allocation => ({
  ...NULLABLE_FIELDS.allocations,
  ...makeMeta(id, companyId),
  resourceId,
  activityId,
  startDate: '2026-01-01',
  endDate: '2026-01-05',
  hoursPerDay: 8,
  status: 'confirmed',
  ...o,
});
export const timeOff = ({
  id,
  companyId,
  resourceId,
  overrides: o = {},
}: TimeOffOptions): TimeOff => ({
  ...NULLABLE_FIELDS.timeOff,
  ...makeMeta(id, companyId),
  resourceId,
  startDate: '2026-01-01',
  endDate: '2026-01-03',
  type: 'holiday',
  ...o,
});

export const A1 = 'acct-1';
export const A2 = 'acct-2';
export const base = (): AppData => ({
  ...emptyAppData(),
  accounts: [makeAccount(A1), makeAccount(A2)],
});
