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

/** Retained planning rows, read and changed in the caller's transaction. */
export class RetainedRowService {
  /** Narrows a product table to one backed by the planning retention lifecycle. */
  isRetainedTable(table: AppDataKey): table is RetainedTable {
    return table in models
  }

  /** Provides a company-scoped lifecycle builder on the caller's transaction. */
  buildRetainedQuery(trx: TransactionClientContract, companyId: string, table: RetainedTable) {
    return models[table].query({ client: trx }).withScopes((scopes) => scopes.forCompany(companyId))
  }
}
