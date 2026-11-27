import { scope } from '@adonisjs/lucid/orm'
import type { LucidRow } from '@adonisjs/lucid/types/model'

/**
 * Model reads that applied an explicit company scope. The record is private to this class, so only
 * `forCompany` marks a query and a read without it fails closed.
 */
export class CompanyScope {
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
export function requireRowCompany(row: LucidRow & { companyId: unknown }) {
  if (typeof row.companyId !== 'string' || row.companyId.trim() === '') {
    throw new Error('A company scope is required for model writes')
  }
  if (row.$isPersisted && Object.hasOwn(row.$dirty, 'companyId')) {
    throw new Error('A stored row keeps its company')
  }
}
