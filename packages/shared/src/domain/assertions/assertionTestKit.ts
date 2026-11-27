import { NULLABLE_FIELDS } from '../../types/nullableFields.js'
import type {
  Activity,
  Allocation,
  Client,
  Company,
  Discipline,
  ID,
  Phase,
  Project,
  Resource,
  TimeOff,
} from '../../types/entities.js'
import { DomainError } from '../errors.js'
import type { DomainErrorCode } from '../errors.js'

export const TS = '2026-01-01T00:00:00.000Z'
export const A1 = 'a-studio'
export const A2 = 'a-loft'

/** The code and the English message a write assertion refuses with; the wire carries both. */
export interface Failure {
  code: DomainErrorCode
  message: string
}

/** Run an assertion and return its refusal, or undefined when it passes. Any other throw escapes. */
export function captureFailure(run: () => unknown): Failure | undefined {
  try {
    run()
  } catch (error) {
    if (!(error instanceof DomainError)) throw error
    return { code: error.code, message: error.message }
  }
  return undefined
}

const makeMeta = (id: ID) => ({ id, companyId: A1, createdAt: TS, updatedAt: TS })

/** Build a company row. */
export const makeCompany = (id: ID, name: string): Company => ({
  ...NULLABLE_FIELDS.companies,
  id,
  name,
  color: '#3b82f6',
  createdAt: TS,
  updatedAt: TS,
})

/** Build a client row in A1 unless overridden. */
export const makeClient = (id: ID, overrides: Partial<Client> = {}): Client => ({
  ...NULLABLE_FIELDS.clients,
  ...makeMeta(id),
  name: 'Gotham City',
  color: '#3b82f6',
  ...overrides,
})

/** Build a project row under client c1 in A1 unless overridden. */
export const makeProject = (id: ID, overrides: Partial<Project> = {}): Project => ({
  ...NULLABLE_FIELDS.projects,
  ...makeMeta(id),
  name: `Project ${id}`,
  clientId: 'c1',
  color: '#3b82f6',
  ...overrides,
})

/** Build a discipline row in A1 unless overridden. */
export const makeDiscipline = (id: ID, overrides: Partial<Discipline> = {}): Discipline => ({
  ...NULLABLE_FIELDS.disciplines,
  ...makeMeta(id),
  name: 'Design',
  sortOrder: 0,
  ...overrides,
})

/** Build a phase row in A1 unless overridden. */
export const makePhase = (id: ID, projectId: ID, overrides: Partial<Phase> = {}): Phase => ({
  ...makeMeta(id),
  name: 'Discovery',
  projectId,
  ...overrides,
})

/** Build a project activity under p1 in A1 unless overridden. */
export const makeActivity = (id: ID, overrides: Partial<Activity> = {}): Activity => ({
  ...NULLABLE_FIELDS.activities,
  ...makeMeta(id),
  name: `Activity ${id}`,
  kind: 'project',
  projectId: 'p1',
  ...overrides,
})

/** Build a person resource in A1 unless overridden. */
export const makePerson = (id: ID, overrides: Partial<Resource> = {}): Resource => ({
  ...NULLABLE_FIELDS.resources,
  ...makeMeta(id),
  kind: 'person',
  name: 'Bruce Wayne',
  jobTitle: 'Designer',
  employmentType: 'permanent',
  engagement: 'studio',
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: '#3b82f6',
  ...overrides,
})

/** Build a placeholder resource bound to projectId. */
export const makePlaceholder = (id: ID, projectId: ID | null): Resource =>
  makePerson(id, { kind: 'placeholder', name: 'Batgirl', projectId })

/** Build an eight-hour confirmed allocation in A1 unless overridden. */
export const makeAllocation = (
  id: ID,
  fields: Pick<Allocation, 'resourceId' | 'activityId'> & Partial<Allocation>
): Allocation => ({
  ...NULLABLE_FIELDS.allocations,
  ...makeMeta(id),
  startDate: '2026-01-05',
  endDate: '2026-01-09',
  hoursPerDay: 8,
  status: 'confirmed',
  ...fields,
})

/** Build a holiday for resourceId in A1 unless overridden. */
export const makeTimeOff = (id: ID, resourceId: ID, overrides: Partial<TimeOff> = {}): TimeOff => ({
  ...NULLABLE_FIELDS.timeOff,
  ...makeMeta(id),
  resourceId,
  startDate: '2026-01-12',
  endDate: '2026-01-13',
  type: 'holiday',
  ...overrides,
})
