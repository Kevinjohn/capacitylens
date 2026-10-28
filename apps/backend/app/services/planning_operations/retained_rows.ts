import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { AppDataKey } from '@capacitylens/shared/types/entities'
import Allocation from '#models/allocation'
import TimeOff from '#models/time_off'
import Closure from '#models/closure'
import Phase from '#models/phase'
import Discipline from '#models/discipline'

/** Planning tables whose deletion lifecycle retains rows for restoration. */
export type RetainedTable = Extract<
  AppDataKey,
  'allocations' | 'timeOff' | 'closures' | 'phases' | 'disciplines'
>

const models = {
  allocations: Allocation,
  timeOff: TimeOff,
  closures: Closure,
  phases: Phase,
  disciplines: Discipline,
}

/** Narrows a product table to one backed by the planning retention lifecycle. */
export function isRetainedTable(table: AppDataKey): table is RetainedTable {
  return table in models
}

/** Provides a company-scoped lifecycle builder on the caller's transaction. */
export function retainedQuery(
  trx: TransactionClientContract,
  accountId: string,
  table: RetainedTable
) {
  return models[table].query({ client: trx }).withScopes((scopes) => scopes.forCompany(accountId))
}
