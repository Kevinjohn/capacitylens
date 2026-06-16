// Fully-populated test fixtures — EVERY optional field set to a non-default value.
// Used by the server round-trip tests (server/src/app.test.ts) and available for
// future app-level tests. Pure data, no behaviour.
import type { Account, Allocation, Client, Discipline, Phase, Project, Resource, Task, TimeOff } from '../types/entities'

const TS1 = '2026-01-01T00:00:00.000Z'
const TS2 = '2026-06-01T12:00:00.000Z'

export const FIXTURE_ACCOUNT: Account = {
  id: 'fix-a1',
  name: 'Fixture Studio',
  color: '#1a2b3c',
  schedulingMode: 'days',
  timezone: 'Europe/London',
  weekStartsOn: 0,
  disciplinesEnabled: false,
  createdAt: TS1,
  updatedAt: TS2,
}

export const FIXTURE_CLIENT: Client = {
  id: 'fix-c1',
  accountId: 'fix-a1',
  name: 'Fixture Client',
  color: '#aabbcc',
  createdAt: TS1,
  updatedAt: TS2,
}

export const FIXTURE_DISCIPLINE: Discipline = {
  id: 'fix-d1',
  accountId: 'fix-a1',
  name: 'Fixture Discipline',
  color: '#ddeeff',
  sortOrder: 7,
  createdAt: TS1,
  updatedAt: TS2,
}

export const FIXTURE_PROJECT: Project = {
  id: 'fix-p1',
  accountId: 'fix-a1',
  name: 'Fixture Project',
  clientId: 'fix-c1',
  color: '#112233',
  createdAt: TS1,
  updatedAt: TS2,
}

export const FIXTURE_PHASE: Phase = {
  id: 'fix-ph1',
  accountId: 'fix-a1',
  name: 'Fixture Phase',
  projectId: 'fix-p1',
  createdAt: TS1,
  updatedAt: TS2,
}

export const FIXTURE_RESOURCE: Resource = {
  id: 'fix-r1',
  accountId: 'fix-a1',
  kind: 'placeholder',
  name: 'Fixture Person',
  role: 'Fixture Role',
  disciplineId: 'fix-d1',
  employmentType: 'contractor',
  workingHoursPerDay: 6,
  workingDays: [1, 2, 3],
  projectId: 'fix-p1',
  color: '#445566',
  createdAt: TS1,
  updatedAt: TS2,
}

export const FIXTURE_TASK: Task = {
  id: 'fix-t1',
  accountId: 'fix-a1',
  name: 'Fixture Task',
  projectId: 'fix-p1',
  phaseId: 'fix-ph1',
  createdAt: TS1,
  updatedAt: TS2,
}

export const FIXTURE_ALLOCATION: Allocation = {
  id: 'fix-al1',
  accountId: 'fix-a1',
  resourceId: 'fix-r1',
  taskId: 'fix-t1',
  startDate: '2026-02-01',
  endDate: '2026-02-28',
  hoursPerDay: 0,
  status: 'tentative',
  note: 'Fixture note',
  ignoreWeekends: true,
  createdAt: TS1,
  updatedAt: TS2,
}

export const FIXTURE_TIMEOFF: TimeOff = {
  id: 'fix-to1',
  accountId: 'fix-a1',
  resourceId: 'fix-r1',
  startDate: '2026-03-01',
  endDate: '2026-03-05',
  type: 'sick',
  note: 'Fixture sick note',
  createdAt: TS1,
  updatedAt: TS2,
}
