import { randomUUID } from 'node:crypto'
import type {
  Company,
  Allocation,
  AppData,
  Closure,
  Resource,
  TimeOff,
} from '@capacitylens/shared/types/entities'
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields'
import { buildCapacitySection } from '@capacitylens/shared/lib/capacity'

const COMPANY = 'a-themyscira'
const stamp = { companyId: COMPANY, createdAt: 't', updatedAt: 't' }

export function companyRow(changes: Partial<Company> = {}): Company {
  return {
    ...NULLABLE_FIELDS.companies,
    id: COMPANY,
    createdAt: 't',
    updatedAt: 't',
    name: 'Themyscira',
    color: '#111111',
    ...changes,
  }
}

export function resource(id: string, changes: Partial<Resource> = {}): Resource {
  return {
    ...NULLABLE_FIELDS.resources,
    ...stamp,
    id,
    kind: 'person',
    name: 'Diana Prince',
    jobTitle: 'Designer',
    employmentType: 'permanent',
    engagement: 'studio',
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
    color: '#111111',
    ...changes,
  }
}

export function allocation(
  changes: Partial<Allocation> & Pick<Allocation, 'startDate'>
): Allocation {
  return {
    ...NULLABLE_FIELDS.allocations,
    ...stamp,
    id: `al-${randomUUID()}`,
    resourceId: 'r-diana',
    activityId: 'act-1',
    endDate: changes.startDate,
    hoursPerDay: 4,
    status: 'confirmed',
    ...changes,
  }
}

export function timeOff(startDate: string, endDate: string): TimeOff {
  return {
    ...NULLABLE_FIELDS.timeOff,
    ...stamp,
    id: `to-${startDate}`,
    resourceId: 'r-diana',
    startDate,
    endDate,
    type: 'holiday',
  }
}

export function closure(startDate: string, endDate: string): Closure {
  return { ...stamp, id: `cl-${startDate}`, name: 'Founding day', startDate, endDate }
}

export function data(rows: Partial<AppData>): AppData {
  return {
    companies: [],
    clients: [],
    disciplines: [],
    projects: [],
    phases: [],
    resources: [resource('r-diana')],
    activities: [],
    allocations: [],
    timeOff: [],
    closures: [],
    ...rows,
  }
}

export function section(
  rows: Partial<AppData>,
  options: { company?: Company; today?: string } = {}
) {
  return buildCapacitySection({
    data: data(rows),
    company: options.company ?? companyRow(),
    today: options.today ?? '2026-06-03',
    window: { from: '2026-06-01', to: '2026-06-14' },
  })
}
