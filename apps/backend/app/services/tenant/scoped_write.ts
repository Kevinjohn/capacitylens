import db from '@adonisjs/lucid/services/db'

export function scopedWrite(table: string, accountId: string) {
  if (accountId.trim() === '') throw new Error('A company scope is required for bulk writes')
  return db.from(table).where('account_id', accountId)
}
