import { scope } from '@adonisjs/lucid/orm';
import type { LucidRow } from '@adonisjs/lucid/types/model';

const scopedQueries = new WeakSet<object>();

/** Restricts a model read to a nonblank company and marks its explicit scope. */
export const forCompany = scope((query, companyId: string) => {
  if (companyId.trim() === '') throw new Error('A company scope is required');
  scopedQueries.add(query);
  // Lucid applies this scope to the caller's awaited builder.
  void query.where('company_id', companyId);
});

/** Refuses model reads that did not apply an explicit company scope. */
export function requireCompanyScope(query: object) {
  if (!scopedQueries.has(query)) throw new Error('A company scope is required for model reads');
}

/**
 * Refuses a model save or delete of a row without a nonblank company, and a save that moves a
 * stored row to another company. Product ids are UUIDs, so scoped models also self-assign them.
 */
export function requireRowCompany(row: LucidRow & { companyId: unknown }) {
  if (typeof row.companyId !== 'string' || row.companyId.trim() === '') {
    throw new Error('A company scope is required for model writes');
  }
  if (row.$isPersisted && Object.hasOwn(row.$dirty, 'companyId')) {
    throw new Error('A stored row keeps its company');
  }
}
