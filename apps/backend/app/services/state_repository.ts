import { assertReleasedMigrations } from '#services/released_migrations'
import db from '@adonisjs/lucid/services/db'
import type { AppData } from '@capacitylens/shared/types/entities'
import { seed } from '@capacitylens/shared/data/seed'
import { activeOnly } from '@capacitylens/shared/domain/lifecycle'
import { assertSchemaIntegrity } from '#services/schema_integrity'
import { withTransaction } from '#services/with_transaction'
import Account from '#models/account'
import Activity from '#models/activity'
import Allocation from '#models/allocation'
import Client from '#models/client'
import Closure from '#models/closure'
import Discipline from '#models/discipline'
import Phase from '#models/phase'
import Project from '#models/project'
import Resource from '#models/resource'
import TimeOff from '#models/time_off'
import type { BaseModel } from '@adonisjs/lucid/orm'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

const tables = {
  accounts: 'accounts',
  clients: 'clients',
  disciplines: 'disciplines',
  projects: 'projects',
  phases: 'phases',
  resources: 'resources',
  activities: 'activities',
  allocations: 'allocations',
  timeOff: 'time_off',
  closures: 'closures',
} as const
export type ProductTable = (typeof tables)[keyof typeof tables]

const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

const jsonColumns = {
  accounts: new Set([
    'weekStartsOn',
    'workingDays',
    'disciplinesEnabled',
    'placeholdersEnabled',
    'externalEnabled',
    'inlineActivityCreateEnabled',
    'showTaskFieldInSchedule',
    'capacityOverviewAccess',
  ]),
  clients: new Set(['isPrivate', 'builtin']),
  disciplines: new Set<string>(),
  projects: new Set(['isPrivate']),
  phases: new Set<string>(),
  resources: new Set(['workingDays', 'halfDays', 'isFavourite']),
  activities: new Set<string>(),
  allocations: new Set(['ignoreWeekends']),
  time_off: new Set<string>(),
  closures: new Set<string>(),
} satisfies Record<(typeof tables)[keyof typeof tables], Set<string>>

const modelColumns = {
  accounts: Account.$columns,
  clients: Client.$columns,
  disciplines: Discipline.$columns,
  projects: Project.$columns,
  phases: Phase.$columns,
  resources: Resource.$columns,
  activities: Activity.$columns,
  allocations: Allocation.$columns,
  time_off: TimeOff.$columns,
  closures: Closure.$columns,
} satisfies Record<ProductTable, readonly string[]>

export function encodeRow(table: ProductTable, row: Record<string, unknown>) {
  return Object.fromEntries(
    modelColumns[table].map((key) => {
      const value = row[key]
      return [
        snake(key),
        jsonColumns[table].has(key) && value !== undefined && value !== null
          ? JSON.stringify(value)
          : (value ?? null),
      ]
    })
  )
}

function serializeRows(rows: InstanceType<typeof BaseModel>[]): Record<string, unknown>[] {
  return rows.map((model) => model.serialize())
}

/** Reads the trusted-local whole database, or one fail-closed tenant slice. */
export async function readStateWithClient(
  client: QueryClientContract,
  accountId?: string,
  includeInactive = accountId === undefined
): Promise<AppData> {
  if (accountId !== undefined && accountId.trim() === '')
    throw new Error('A company scope is required')
  const [
    accounts,
    clients,
    disciplines,
    projects,
    phases,
    resources,
    activities,
    allocations,
    timeOff,
    closures,
  ] = await Promise.all([
    accountId === undefined
      ? Account.query({ client })
      : Account.query({ client }).where('id', accountId),
    accountId === undefined
      ? Client.query({ client }).withScopes((scopes) => scopes.forTrustedLocal())
      : Client.query({ client }).withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? Discipline.query({ client }).withScopes((scopes) => scopes.forTrustedLocal())
      : Discipline.query({ client }).withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? Project.query({ client }).withScopes((scopes) => scopes.forTrustedLocal())
      : Project.query({ client }).withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? Phase.query({ client }).withScopes((scopes) => scopes.forTrustedLocal())
      : Phase.query({ client }).withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? Resource.query({ client }).withScopes((scopes) => scopes.forTrustedLocal())
      : Resource.query({ client }).withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? Activity.query({ client }).withScopes((scopes) => scopes.forTrustedLocal())
      : Activity.query({ client }).withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? Allocation.query({ client }).withScopes((scopes) => scopes.forTrustedLocal())
      : Allocation.query({ client }).withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? TimeOff.query({ client }).withScopes((scopes) => scopes.forTrustedLocal())
      : TimeOff.query({ client }).withScopes((scopes) => scopes.forCompany(accountId)),
    accountId === undefined
      ? Closure.query({ client }).withScopes((scopes) => scopes.forTrustedLocal())
      : Closure.query({ client }).withScopes((scopes) => scopes.forCompany(accountId)),
  ])
  const data = {
    accounts: serializeRows(accounts),
    clients: serializeRows(clients),
    disciplines: serializeRows(disciplines),
    projects: serializeRows(projects),
    phases: serializeRows(phases),
    resources: serializeRows(resources),
    activities: serializeRows(activities),
    allocations: serializeRows(allocations),
    timeOff: serializeRows(timeOff),
    closures: serializeRows(closures),
  } as unknown as AppData
  return includeInactive ? data : activeOnly(data)
}

/** Reads through an explicit ordinary connection; batch callers pass their transaction instead. */
export function readState(accountId?: string, includeInactive = accountId === undefined) {
  return readStateWithClient(db.connection(), accountId, includeInactive)
}

export async function resetState(seedRequested: boolean) {
  await withTransaction(async (trx) => {
    await trx.from('audit_entries').delete()
    for (const table of Object.values(tables).reverse()) await trx.from(table).delete()
    if (!seedRequested) return
    const data = seed()
    for (const [key, table] of Object.entries(tables)) {
      const rows = data[key as keyof typeof tables]
      if (rows.length > 0)
        await trx
          .table(table)
          .multiInsert(
            rows.map((row) => encodeRow(table, row as unknown as Record<string, unknown>))
          )
    }
  })
}

export const replaceWithSeed = () => resetState(true)

export async function checkDatabase() {
  await assertReleasedMigrations()
  await db.rawQuery('select 1')
  await assertSchemaIntegrity()
}
