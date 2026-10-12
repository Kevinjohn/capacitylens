import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export async function withTransaction<T>(
  work: (trx: TransactionClientContract) => Promise<T>
): Promise<T> {
  const trx = await db.transaction()
  try {
    const result = await work(trx)
    await trx.commit()
    return result
  } catch (workError) {
    try {
      await trx.rollback()
    } catch (rollbackError) {
      throw new AggregateError(
        [workError, rollbackError],
        'Transaction work and rollback both failed'
      )
    }
    throw workError
  }
}
