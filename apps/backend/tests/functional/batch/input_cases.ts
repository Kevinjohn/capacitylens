import type { AppData } from '@capacitylens/shared/types/entities'

export type InputCase = {
  table: keyof AppData
  row: Record<string, unknown>
  field: string
  invalid: unknown
}

const longName = 'N'.repeat(101)
const longNote = 'n'.repeat(1001)

function one<T extends keyof AppData>(data: AppData, table: T, id: string) {
  const row = (data[table] as unknown as Array<Record<string, unknown>>).find(
    (item) => item.id === id
  )
  if (!row) throw new Error(`Missing seeded ${table} row ${id}`)
  return row
}

/** Field values copied from the legacy ordinary-write contract matrix. */
export function invalidFieldCases(data: AppData): InputCase[] {
  const cases: InputCase[] = []
  const add = (
    table: keyof AppData,
    row: Record<string, unknown>,
    fields: Array<[string, unknown]>
  ) => {
    for (const [field, invalid] of fields) cases.push({ table, row, field, invalid })
  }

  add('accounts', one(data, 'accounts', 'a-studio'), [
    ['name', longName],
    ['color', '#123456'],
    ['schedulingMode', 'yearly'],
    ['capacityOverviewAccess', 'anyone'],
    ['dateStyle', 'unknown'],
    ['language', 'cy'],
    ['disciplinesEnabled', 'yes'],
    ['placeholdersEnabled', 1],
    ['externalEnabled', 'yes'],
    ['inlineActivityCreateEnabled', 'false'],
    ['showTaskFieldInSchedule', 0],
    ['workingDays', [1, 1]],
    ['weekStartsOn', 3],
    ['timezone', 'Mars/Olympus'],
  ])
  add('clients', one(data, 'clients', 'c-acme'), [
    ['name', longName],
    ['color', '#123456'],
    ['isPrivate', 'yes'],
    ['codeName', longName],
  ])
  add('projects', one(data, 'projects', 'p-acme'), [
    ['name', longName],
    ['color', '#123456'],
    ['isPrivate', 1],
    ['codeName', longName],
    ['clientId', 'c-loft-northwind'],
  ])
  add('disciplines', one(data, 'disciplines', 'd-design'), [
    ['name', longName],
    ['color', '#123456'],
    ['sortOrder', 1.5],
  ])
  add('phases', one(data, 'phases', 'ph-disc'), [
    ['name', longName],
    ['projectId', 'p-loft-app'],
  ])
  add('activities', one(data, 'activities', 't-wires'), [
    ['name', longName],
    ['kind', 'other'],
    ['projectId', 'p-loft-app'],
    ['phaseId', 'ph-loft'],
  ])
  add('resources', one(data, 'resources', 'r-tyler'), [
    ['kind', 'other'],
    ['name', longName],
    ['role', longName],
    ['employmentType', 'other'],
    ['engagement', 'other'],
    ['workingHoursPerDay', 25],
    ['workingDays', [7]],
    ['halfDays', [0]],
    ['color', '#123456'],
    ['isFavourite', 'true'],
    ['firstAvailableDate', '2026-02-30'],
    ['lastAvailableDate', '2026-02-30'],
    ['avatarUrl', 'http://images.example/avatar.png'],
    ['disciplineId', 'd-loft-design'],
  ])
  add('allocations', one(data, 'allocations', 'a-tyler-1'), [
    ['resourceId', 'r-jo'],
    ['activityId', 't-loft-screens'],
    ['startDate', '2026-02-30'],
    ['endDate', '2026-02-30'],
    ['hoursPerDay', 25],
    ['hoursPerDay', '4'],
    ['status', 'maybe'],
    ['note', longNote],
    ['task', longName],
    ['ignoreWeekends', 1],
    ['projectId', 'p-loft-app'],
  ])
  add('timeOff', one(data, 'timeOff', 'to-tyler'), [
    ['resourceId', 'r-jo'],
    ['startDate', '2026-02-30'],
    ['endDate', '2026-02-30'],
    ['type', 'unsupported'],
    ['note', longNote],
  ])
  add(
    'closures',
    {
      id: 'input-contract-closure',
      accountId: 'a-studio',
      name: 'Studio closure',
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      createdAt: '2026-10-12T00:00:00.000Z',
      updatedAt: '2026-10-12T00:00:00.000Z',
    },
    [
      ['name', longName],
      ['startDate', '2026-02-30'],
      ['endDate', '2026-02-30'],
    ]
  )
  return cases
}
