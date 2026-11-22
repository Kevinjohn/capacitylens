import { scope } from '@adonisjs/lucid/orm';

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
