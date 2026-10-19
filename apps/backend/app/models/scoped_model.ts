import { scope } from '@adonisjs/lucid/orm'

const scopedQueries = new WeakSet<object>()

export const forCompany = scope((query, accountId: string) => {
  if (accountId.trim() === '') throw new Error('A company scope is required')
  scopedQueries.add(query)
  query.where('account_id', accountId)
})

/** Marks the trusted-local whole-database read used only when no tenant is selected. */
export const forTrustedLocal = scope((query) => {
  scopedQueries.add(query)
})

export function requireCompanyScope(query: object) {
  if (!scopedQueries.has(query)) throw new Error('A company scope is required for model reads')
}
