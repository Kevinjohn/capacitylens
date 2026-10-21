import { randomUUID } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { AppData } from '@capacitylens/shared/types/entities'
import { encodeRow } from '#services/state_repository'
import { existingRow, PlanningOperationError } from './writer.js'

/** The identities that bind a restoration group to one actor's native session and mutation. */
export interface RestorationIdentity {
  actorId: string
  sessionId: string
  mutationId: string
}

/** Saves the complete stored allocations as one new group, then deletes exactly those rows. */
export async function deleteAllocations(
  trx: TransactionClientContract,
  data: AppData,
  accountId: string,
  ids: string[],
  identity: RestorationIdentity
) {
  const rows = ids.map((id) => existingRow(data, 'allocations', id))
  const groupId = randomUUID()
  await trx.table('deleted_groups').insert({
    group_id: groupId,
    account_id: accountId,
    actor_id: identity.actorId,
    session_id: identity.sessionId,
    mutation_id: identity.mutationId,
    created_at: new Date().toISOString(),
    consumed_at: null,
  })
  await trx.table('deleted_rows').multiInsert(
    rows.map((row) => ({
      group_id: groupId,
      entity: 'allocations',
      row_id: row.id,
      payload_json: JSON.stringify(row),
    }))
  )
  await trx.from('allocations').where('account_id', accountId).whereIn('id', ids).delete()
  return groupId
}

/** Consumes the caller's own group once and reinserts its saved rows exactly as they were stored. */
export async function restoreGroup(
  trx: TransactionClientContract,
  accountId: string,
  groupId: string,
  identity: RestorationIdentity
) {
  const owner = {
    group_id: groupId,
    account_id: accountId,
    actor_id: identity.actorId,
    session_id: identity.sessionId,
  }
  const consumed = await trx
    .from('deleted_groups')
    .where(owner)
    .whereNull('consumed_at')
    .update({ consumed_at: new Date().toISOString() })
  if (!consumed) {
    if (await trx.from('deleted_groups').where(owner).select('group_id').first())
      throw new PlanningOperationError(
        409,
        'restoration_consumed',
        'This deletion has already been restored.'
      )
    throw new PlanningOperationError(403, 'authorization_denied', 'This action is not allowed.')
  }
  const saved = await trx
    .from('deleted_rows')
    .where({ group_id: groupId, entity: 'allocations' })
    .select('payload_json')
  for (const { payload_json: payload } of saved)
    await trx.table('allocations').insert(encodeRow('allocations', JSON.parse(String(payload))))
}

/** Lookup exposes only the caller's own unconsumed handle for the original mutation. */
export async function unconsumedGroupId(
  trx: TransactionClientContract,
  accountId: string,
  identity: RestorationIdentity
) {
  const group = await trx
    .from('deleted_groups')
    .where({
      account_id: accountId,
      actor_id: identity.actorId,
      session_id: identity.sessionId,
      mutation_id: identity.mutationId,
    })
    .whereNull('consumed_at')
    .select('group_id')
    .first()
  return group ? String(group.group_id) : undefined
}
