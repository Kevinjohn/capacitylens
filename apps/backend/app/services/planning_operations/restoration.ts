import { randomUUID } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { Allocation, AppData } from '@capacitylens/shared/types/entities'
import {
  assertAllocationRefs,
  assertScopedRefs,
  assertDateRange,
} from '@capacitylens/shared/domain/mutations'
import { assertAllocationPlacement } from '@capacitylens/shared/domain/placement'
import { DomainError } from '@capacitylens/shared/domain/errors'
import { normalizeAccountWorkingDays } from '@capacitylens/shared/lib/accountWorkingDays'
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
  // Knex emits one compound SELECT term per row; SQLite allows at most 500 per statement and
  // 32,766 bound variables, so the listed ids are deleted in the same bounded slices.
  for (let start = 0; start < rows.length; start += 500) {
    await trx.table('deleted_rows').multiInsert(
      rows.slice(start, start + 500).map((row) => ({
        group_id: groupId,
        entity: 'allocations',
        row_id: row.id,
        payload_json: JSON.stringify(row),
      }))
    )
    await trx
      .from('allocations')
      .where('account_id', accountId)
      .whereIn('id', ids.slice(start, start + 500))
      .delete()
  }
  return groupId
}

/** Consumes the caller's own group once and reinserts its saved rows exactly as they were stored. */
export async function restoreGroup(
  trx: TransactionClientContract,
  accountId: string,
  data: AppData,
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
  const rows = saved.map(({ payload_json: payload }) => JSON.parse(String(payload)) as Allocation)
  const account = data.accounts.find((row) => row.id === accountId)
  const accountWorkingDays = normalizeAccountWorkingDays(
    account?.workingDays,
    account?.weekStartsOn === 0 ? 0 : 1
  )
  try {
    for (const row of rows) {
      const activity = data.activities.find((item) => item.id === row.activityId)
      if (activity) assertScopedRefs(data, accountId, 'activities', { ...activity })
      assertAllocationRefs(
        data,
        accountId,
        row.resourceId,
        row.activityId,
        row.hoursPerDay,
        row.projectId
      )
      assertDateRange(row.startDate, row.endDate)
      const resource = data.resources.find((item) => item.id === row.resourceId)!
      assertAllocationPlacement({ allocation: row, resource, accountWorkingDays })
    }
  } catch (error) {
    if (!(error instanceof DomainError)) throw error
    throw new PlanningOperationError(
      409,
      'restoration_conflict',
      'The saved allocations no longer fit the current planning data.'
    )
  }
  for (const row of rows)
    await trx.table('allocations').insert(encodeRow('allocations', { ...row }))
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
