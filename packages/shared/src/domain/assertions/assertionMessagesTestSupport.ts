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
  accountId: ID;
  projectId: ID;
  phaseId?: ID;
}

interface AllocationOptions {
  id: ID;
  accountId: ID;
  resourceId: ID;
  activityId: ID;
  overrides?: Partial<Allocation>;
}

interface TimeOffOptions {
  id: ID;
  accountId: ID;
  resourceId: ID;
  overrides?: Partial<TimeOff>;
}

export const TS = '2026-01-01T00:00:00.000Z';
export const meta = (id: ID, accountId: ID) => ({
  id,
  accountId,
  createdAt: TS,
  updatedAt: TS,
});

export const account = (id: ID, name = 'Co'): Account => ({
  ...NULLABLE_FIELDS.accounts,
  id,
  name,
  color: '#3b82f6',
  createdAt: TS,
  updatedAt: TS,
});
export const client = (id: ID, accountId: ID, name = 'Ferris'): Client => ({
  ...NULLABLE_FIELDS.clients,
  ...meta(id, accountId),
  name,
  color: '#3b82f6',
});
export const project = (id: ID, accountId: ID, clientId: ID): Project => ({
  ...NULLABLE_FIELDS.projects,
  ...meta(id, accountId),
  name: 'Web',
  clientId,
  color: '#3b82f6',
});
export const phase = (id: ID, accountId: ID, projectId: ID): Phase => ({
  ...meta(id, accountId),
  name: 'Discovery',
  projectId,
});
export const activity = ({ id, accountId, projectId, phaseId }: ActivityOptions): Activity => ({
  ...NULLABLE_FIELDS.activities,
  ...meta(id, accountId),
  name: 'Activity',
  kind: 'project',
  projectId,
  ...(phaseId === undefined ? {} : { phaseId }),
});
export const person = (id: ID, accountId: ID): Resource => ({
  ...NULLABLE_FIELDS.resources,
  ...meta(id, accountId),
  kind: 'person',
  role: 'Designer',
  employmentType: 'permanent',
  engagement: 'studio' as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: '#3b82f6',
});
export const discipline = (id: ID, accountId: ID): Discipline => ({
  ...NULLABLE_FIELDS.disciplines,
  ...meta(id, accountId),
  name: 'Design',
  sortOrder: 0,
});
export const placeholder = (id: ID, accountId: ID, projectId?: ID): Resource => ({
  ...person(id, accountId),
  kind: 'placeholder',
  ...(projectId === undefined ? {} : { projectId }),
});
export const external = (id: ID, accountId: ID): Resource => ({
  ...person(id, accountId),
  kind: 'external',
});
export const allocation = ({
  id,
  accountId,
  resourceId,
  activityId,
  overrides: o = {},
}: AllocationOptions): Allocation => ({
  ...NULLABLE_FIELDS.allocations,
  ...meta(id, accountId),
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
  accountId,
  resourceId,
  overrides: o = {},
}: TimeOffOptions): TimeOff => ({
  ...NULLABLE_FIELDS.timeOff,
  ...meta(id, accountId),
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
  accounts: [account(A1), account(A2)],
});
