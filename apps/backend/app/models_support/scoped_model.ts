import type { NormalizeConstructor } from '@adonisjs/core/types/helpers'
import {
  type BaseModel,
  beforeDelete,
  beforeFetch,
  beforeFind,
  beforeSave,
  scope,
} from '@adonisjs/lucid/orm'
import type { LucidModel, LucidRow, ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'

/**
 * Model reads that applied an explicit company scope. The record is private to this class, so only
 * `forCompany` marks a query and a read without it fails closed.
 */
class CompanyScope {
  static #scopedQueries = new WeakSet<object>()

  /** Restricts a model read to a nonblank company and marks its explicit scope. */
  static forCompany = scope((query, companyId: string) => {
    if (companyId.trim() === '') throw new Error('A company scope is required')
    CompanyScope.#scopedQueries.add(query)
    // Lucid applies this scope to the caller's awaited builder.
    void query.where('company_id', companyId)
  })

  /** Refuses model reads that did not apply an explicit company scope. */
  static requireCompanyScope(query: object) {
    if (!CompanyScope.#scopedQueries.has(query)) {
      throw new Error('A company scope is required for model reads')
    }
  }
}

/**
 * Refuses a model save or delete of a row without a nonblank company, and a save that moves a
 * stored row to another company. Product ids are UUIDs, so scoped models also self-assign them.
 */
function requireRowCompany(row: LucidRow & { companyId: unknown }) {
  if (typeof row.companyId !== 'string' || row.companyId.trim() === '') {
    throw new Error('A company scope is required for model writes')
  }
  if (row.$isPersisted && Object.hasOwn(row.$dirty, 'companyId')) {
    throw new Error('A stored row keeps its company')
  }
}

/** Static members added by `withCompanyScope`. */
export interface CompanyScopedStatics {
  forCompany: typeof CompanyScope.forCompany
  selfAssignPrimaryKey: boolean
  requireFindScope<Model extends LucidModel>(query: ModelQueryBuilderContract<Model>): void
  requireFetchScope<Model extends LucidModel>(query: ModelQueryBuilderContract<Model>): void
  requireWriteScope(row: LucidRow & { companyId: unknown }): void
}

/** Constructor type returned by `withCompanyScope(Superclass)`. */
export type CompanyScopedConstructor<T extends NormalizeConstructor<typeof BaseModel>> = Omit<
  T,
  'constructor'
> &
  CompanyScopedStatics & {
    new (...args: never[]): InstanceType<T>
  }

/** Mixin that enforces company-scoped reads, writes, and UUID primary keys on a product model. */
export function withCompanyScope<T extends NormalizeConstructor<typeof BaseModel>>(
  Superclass: T
): CompanyScopedConstructor<T> {
  class CompanyScopedModel extends Superclass {
    static forCompany = CompanyScope.forCompany
    static selfAssignPrimaryKey = true

    @beforeFind()
    static requireFindScope(query: ModelQueryBuilderContract<typeof CompanyScopedModel>) {
      CompanyScope.requireCompanyScope(query)
    }

    @beforeFetch()
    static requireFetchScope(query: ModelQueryBuilderContract<typeof CompanyScopedModel>) {
      CompanyScope.requireCompanyScope(query)
    }

    @beforeSave()
    @beforeDelete()
    static requireWriteScope(row: LucidRow & { companyId: unknown }) {
      requireRowCompany(row)
    }
  }

  return CompanyScopedModel as unknown as CompanyScopedConstructor<T>
}
