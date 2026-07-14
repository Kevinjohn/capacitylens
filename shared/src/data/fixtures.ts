// Fully-populated test fixtures — EVERY optional field set to a non-default value.
// Used by the server round-trip tests (server/src/app.test.ts) and available for
// future app-level tests. Pure data, no behaviour.
import { externalCapacityDefaults } from '../types/entities'
import { NEUTRAL_COLOR } from '../lib/color'
import type { Account, Allocation, Client, Discipline, Phase, Project, Resource, Activity, TimeOff } from '../types/entities'

const TS1 = '2026-01-01T00:00:00.000Z'
const TS2 = '2026-06-01T12:00:00.000Z'

export const FIXTURE_ACCOUNT: Account = {
  id: 'fix-a1',
  name: 'Fixture Studio',
  color: '#1a2b3c',
  schedulingMode: 'days',
  timezone: 'Europe/London',
  weekStartsOn: 0,
  language: 'en',
  disciplinesEnabled: false,
  // Both true (the NON-default — absent reads as false/hidden) so the server round-trip test
  // proves the new optional boolean columns persist a PRESENT value, not just absence.
  placeholdersEnabled: true,
  externalEnabled: true,
  createdAt: TS1,
  updatedAt: TS2,
}

export const FIXTURE_CLIENT: Client = {
  id: 'fix-c1',
  accountId: 'fix-a1',
  name: 'Fixture Client',
  color: '#aabbcc',
  // Built-in flag set so the round-trip test proves the new optional column persists (true/false →
  // JSON column, omitted when absent). The built-in Internal client owns real projects, so a project
  // (FIXTURE_PROJECT) pointing at it is valid.
  builtin: true,
  // Lifecycle timestamps set to PRESENT (non-default-absent) values so the server round-trip test
  // proves the new optional archivedAt/deletedAt columns persist a present value, not just absence.
  archivedAt: TS1,
  deletedAt: TS2,
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
  // Lifecycle timestamps set to PRESENT (non-default-absent) values so the server round-trip test
  // proves the new optional archivedAt/deletedAt columns persist a present value, not just absence.
  archivedAt: TS1,
  deletedAt: TS2,
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
  name: 'Fixture Placeholder',
  role: 'Fixture Role',
  disciplineId: 'fix-d1',
  employmentType: 'contractor',
  workingHoursPerDay: 6,
  workingDays: [1, 2, 3],
  projectId: 'fix-p1',
  color: '#445566',
  // Lifecycle timestamps set to PRESENT (non-default-absent) values so the server round-trip test
  // proves the new optional archivedAt/deletedAt columns persist a present value, not just absence.
  archivedAt: TS1,
  deletedAt: TS2,
  createdAt: TS1,
  updatedAt: TS2,
}

/** The external / 3rd-party kind: a company name + optional descriptor, and NO discipline or
 *  project binding (externals carry unused silent-default working hours/days). Proves `kind`
 *  round-trips through the server with the optional FK columns left NULL. */
export const FIXTURE_RESOURCE_EXTERNAL: Resource = {
  id: 'fix-r2',
  accountId: 'fix-a1',
  kind: 'external',
  name: 'Fixture External Co',
  role: 'Fixture Partner',
  ...externalCapacityDefaults(),
  color: NEUTRAL_COLOR,
  createdAt: TS1,
  updatedAt: TS2,
}

export const FIXTURE_ACTIVITY: Activity = {
  id: 'fix-t1',
  accountId: 'fix-a1',
  name: 'Fixture Activity',
  kind: 'project',
  projectId: 'fix-p1',
  phaseId: 'fix-ph1',
  createdAt: TS1,
  updatedAt: TS2,
}

/** The internal & repeatable kinds: project-less by definition, so they OMIT projectId /
 *  phaseId entirely (not null — absent). Prove all three ActivityKind values round-trip through
 *  the server with the optional FK columns left NULL. */
export const FIXTURE_ACTIVITY_INTERNAL: Activity = {
  id: 'fix-t2',
  accountId: 'fix-a1',
  name: 'Fixture Internal Activity',
  kind: 'internal',
  createdAt: TS1,
  updatedAt: TS2,
}

export const FIXTURE_ACTIVITY_REPEATABLE: Activity = {
  id: 'fix-t3',
  accountId: 'fix-a1',
  name: 'Fixture Repeatable Activity',
  kind: 'repeatable',
  createdAt: TS1,
  updatedAt: TS2,
}

export const FIXTURE_ALLOCATION: Allocation = {
  id: 'fix-al1',
  accountId: 'fix-a1',
  resourceId: 'fix-r1',
  activityId: 'fix-t1',
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
