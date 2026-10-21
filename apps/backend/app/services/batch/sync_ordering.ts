import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { BatchOp, SyncOrder } from '#services/batch/types'
import { TABLE_NAMES } from '#services/batch/entity_policy'

async function hashRow(row: Record<string, unknown>) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(row))
  )
  return Buffer.from(digest).toString('hex')
}

export async function isSuperseded(trx: TransactionClientContract, order: SyncOrder) {
  const row = await trx
    .from('capacitylens_sync_sessions')
    .where('session_id', order.sessionId)
    .first()
  return row !== null && row.last_sequence >= order.sequence
}

export async function isSameSessionSuccessor(
  trx: TransactionClientContract,
  order: SyncOrder,
  table: string,
  id: string,
  currentRow: Record<string, unknown>
) {
  const provenance = await trx
    .from('capacitylens_sync_row_provenance')
    .where({ table_name: table, row_id: id })
    .first()
  if (
    !provenance ||
    provenance.session_id !== order.sessionId ||
    provenance.sequence >= order.sequence
  )
    return false
  const rawHash = await hashRow(currentRow)
  return provenance.row_hash === rawHash
}

export async function recordSync(trx: TransactionClientContract, order: SyncOrder, ops: BatchOp[]) {
  const nowDate = new Date()
  const now = nowDate.toISOString()
  const cutoff = new Date(nowDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const expired = trx
    .from('capacitylens_sync_sessions')
    .select('session_id')
    .where('updated_at', '<', cutoff)
  await trx.from('capacitylens_sync_row_provenance').whereIn('session_id', expired).delete()
  await trx.from('capacitylens_sync_sessions').where('updated_at', '<', cutoff).delete()
  await trx
    .table('capacitylens_sync_sessions')
    .insert({ session_id: order.sessionId, last_sequence: order.sequence, updated_at: now })
    .onConflict('session_id')
    .merge({ last_sequence: order.sequence, updated_at: now })
  for (const op of ops) {
    const row = await trx.from(TABLE_NAMES[op.table]).where('id', op.id).first()
    if (!row) {
      await trx
        .from('capacitylens_sync_row_provenance')
        .where({ table_name: op.table, row_id: op.id })
        .delete()
      continue
    }
    const accountId = op.table === 'accounts' ? op.id : String(row.account_id)
    const rowHash = await hashRow(row)
    await trx
      .table('capacitylens_sync_row_provenance')
      .insert({
        table_name: op.table,
        row_id: op.id,
        account_id: accountId,
        session_id: order.sessionId,
        sequence: order.sequence,
        row_hash: rowHash,
      })
      .onConflict(['table_name', 'row_id'])
      .merge()
  }
}
