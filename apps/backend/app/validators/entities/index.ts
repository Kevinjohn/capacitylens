import vine from '@vinejs/vine'
import type { AppDataKey } from '@capacitylens/shared/types/entities'
import { fieldSchema, type FieldKind } from './fields.js'
import { rejectUnknownFields } from '#validators/rules/unknown_fields'

const base = { id: 'identifier', createdAt: 'identifier', updatedAt: 'identifier' } as const
const scoped = { ...base, accountId: 'identifier' } as const
const lifecycle = { archivedAt: 'identifier', deletedAt: 'identifier' } as const
const privateName = { isPrivate: 'boolean', codeName: 'text' } as const
const dates = { startDate: 'date', endDate: 'date' } as const

/** The supplied fields each entity command accepts. The Vine object itself rejects unknown keys. */
export const entityFields: Record<AppDataKey, Record<string, FieldKind>> = {
  accounts: {
    ...base,
    name: 'text',
    color: 'color',
    schedulingMode: 'choice',
    timezone: 'timezone',
    weekStartsOn: 'weekStart',
    workingDays: 'weekdays',
    language: 'choice',
    disciplinesEnabled: 'boolean',
    placeholdersEnabled: 'boolean',
    externalEnabled: 'boolean',
    inlineActivityCreateEnabled: 'boolean',
    showTaskFieldInSchedule: 'boolean',
    capacityOverviewAccess: 'choice',
    dateStyle: 'choice',
  },
  disciplines: { ...scoped, name: 'text', color: 'color', sortOrder: 'number' },
  resources: {
    ...scoped,
    ...lifecycle,
    kind: 'choice',
    name: 'text',
    role: 'text',
    avatarUrl: 'avatar',
    disciplineId: 'identifier',
    employmentType: 'choice',
    engagement: 'choice',
    workingHoursPerDay: 'number',
    workingDays: 'weekdays',
    halfDays: 'weekdays',
    projectId: 'identifier',
    color: 'color',
    isFavourite: 'boolean',
    firstAvailableDate: 'date',
    lastAvailableDate: 'date',
  },
  clients: {
    ...scoped,
    ...lifecycle,
    ...privateName,
    name: 'text',
    color: 'color',
    builtin: 'boolean',
  },
  projects: {
    ...scoped,
    ...lifecycle,
    ...privateName,
    name: 'text',
    clientId: 'identifier',
    color: 'color',
  },
  phases: { ...scoped, name: 'text', projectId: 'identifier' },
  activities: {
    ...scoped,
    ...lifecycle,
    name: 'text',
    kind: 'choice',
    projectId: 'identifier',
    phaseId: 'identifier',
  },
  allocations: {
    ...scoped,
    ...dates,
    resourceId: 'identifier',
    activityId: 'identifier',
    projectId: 'identifier',
    hoursPerDay: 'number',
    status: 'choice',
    note: 'note',
    task: 'text',
    ignoreWeekends: 'boolean',
    seriesId: 'identifier',
  },
  timeOff: { ...scoped, ...dates, resourceId: 'identifier', type: 'choice', note: 'note' },
  closures: { ...scoped, ...dates, name: 'text' },
}

export const requiredFields: Record<AppDataKey, readonly string[]> = {
  accounts: ['name', 'color'],
  disciplines: ['accountId', 'name', 'sortOrder'],
  resources: [
    'accountId',
    'kind',
    'role',
    'employmentType',
    'workingHoursPerDay',
    'workingDays',
    'color',
  ],
  clients: ['accountId', 'name', 'color'],
  projects: ['accountId', 'name', 'color', 'clientId'],
  phases: ['accountId', 'name', 'projectId'],
  activities: ['accountId', 'name', 'kind'],
  allocations: [
    'accountId',
    'resourceId',
    'activityId',
    'startDate',
    'endDate',
    'hoursPerDay',
    'status',
  ],
  timeOff: ['accountId', 'resourceId', 'startDate', 'endDate', 'type'],
  closures: ['accountId', 'name', 'startDate', 'endDate'],
}

/** Validate one complete PUT body without coercing its supplied scalar values. */
export async function validateEntityRow(table: AppDataKey, row: Record<string, unknown>) {
  const properties = Object.fromEntries(
    Object.entries(entityFields[table]).map(([field, kind]) => [
      field,
      fieldSchema(table, field, kind, row),
    ])
  )
  return vine
    .compile(
      vine
        .object(properties)
        .allowUnknownProperties()
        .use(rejectUnknownFields(Object.keys(properties)))
    )
    .validate(row) as Promise<Record<string, unknown>>
}
