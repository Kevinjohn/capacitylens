import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export function scopedWrite(trx: TransactionClientContract, table: string, accountId: string) {
  if (accountId.trim() === '') throw new Error('A company scope is required for bulk writes')
  return trx.from(table).where('account_id', accountId)
}
