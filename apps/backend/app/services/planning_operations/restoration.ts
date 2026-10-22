import { randomUUID } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import {
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertScopedRefs,
} from '@capacitylens/shared/domain/mutations'
import { assertAllocationPlacement } from '@capacitylens/shared/domain/placement'
import { normalizeAccountWorkingDays } from '@capacitylens/shared/lib/accountWorkingDays'
import type { Allocation, AppData, AppDataKey } from '@capacitylens/shared/types/entities'
import { encodeRow, readStateWithClient } from '#services/state_repository'
import { TABLE_NAMES } from '#services/planning_operations/entity_policy'
import { createServerRevision } from '#services/planning_operations/revision'
import { existingRow, PlanningOperationError } from './writer.js'

/** The identities that bind a restoration group to one actor's native session and mutation. */
export interface RestorationIdentity {
  actorId: string
  sessionId: string
  mutationId: string
}

type DeletableTable = Extract<
  AppDataKey,
  'allocations' | 'phases' | 'disciplines' | 'timeOff' | 'closures'
>
type SavedRow = { kind: 'row'; row: Record<string, unknown> }
type SavedLink = { kind: 'link'; parentId: string }

function conflict(): never {
  throw new PlanningOperationError(
    409,
    'restoration_conflict',
    'The deleted records can no longer be restored.'
  )
}

/** Saves complete stored rows and narrow surviving-child links, then deletes only listed rows. */
export async function deleteRows(
  trx: TransactionClientContract,
  data: AppData,
  accountId: string,
  table: DeletableTable,
  ids: string[],
  identity: RestorationIdentity
) {
  const rows = ids.map((id) => existingRow(data, table, id))
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
  const links = rows.flatMap((row) =>
    table === 'phases'
      ? data.activities
          .filter((child) => child.phaseId === row.id)
          .map((child) => ({ entity: 'activities', rowId: child.id, parentId: row.id }))
      : table === 'disciplines'
        ? data.resources
            .filter((child) => child.disciplineId === row.id)
            .map((child) => ({ entity: 'resources', rowId: child.id, parentId: row.id }))
        : []
  )
  const saved = [
    ...rows.map((row) => ({
      group_id: groupId,
      entity: table,
      row_id: row.id,
      payload_json: JSON.stringify({ kind: 'row', row } satisfies SavedRow),
    })),
    ...links.map((link) => ({
      group_id: groupId,
      entity: link.entity,
      row_id: link.rowId,
      payload_json: JSON.stringify({ kind: 'link', parentId: link.parentId } satisfies SavedLink),
    })),
  ]
  // SQLite bounds compound inserts and variables; all slices remain in the caller's transaction.
  for (let start = 0; start < saved.length; start += 500)
    await trx.table('deleted_rows').multiInsert(saved.slice(start, start + 500))
  for (let start = 0; start < ids.length; start += 500)
    await trx
      .from(TABLE_NAMES[table])
      .where('account_id', accountId)
      .whereIn('id', ids.slice(start, start + 500))
      .delete()
  return groupId
}

/** Existing allocation callers share the same restoration representation. */
export const deleteAllocations = (
  trx: TransactionClientContract,
  data: AppData,
  accountId: string,
  ids: string[],
  identity: RestorationIdentity
) => deleteRows(trx, data, accountId, 'allocations', ids, identity)

/** Consumes the caller's group once, restoring parents before selectively relinking survivors. */
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
    const origin = await trx
      .from('planning_mutations')
      .where({
        account_id: accountId,
        actor_id: identity.actorId,
        origin_session_id: identity.sessionId,
        restoration_group_id: groupId,
      })
      .select('mutation_id')
      .first()
    if (origin)
      throw new PlanningOperationError(
        409,
        'restoration_invalidated',
        'This deletion can no longer be restored.'
      )
    throw new PlanningOperationError(403, 'authorization_denied', 'This action is not allowed.')
  }
  const saved = await trx
    .from('deleted_rows')
    .where({ group_id: groupId })
    .select('entity', 'row_id', 'payload_json')
  const rows: Array<{ entity: DeletableTable; row: Record<string, unknown> }> = []
  const links: Array<{ entity: 'activities' | 'resources'; rowId: string; parentId: string }> = []
  for (const item of saved) {
    const payload = JSON.parse(String(item.payload_json)) as SavedRow | SavedLink
    if (payload.kind === 'row')
      rows.push({ entity: item.entity as DeletableTable, row: payload.row })
    else
      links.push({
        entity: item.entity as 'activities' | 'resources',
        rowId: String(item.row_id),
        parentId: payload.parentId,
      })
  }
  const dependencies = await readStateWithClient(trx, accountId, true)
  const account = dependencies.accounts.find((row) => row.id === accountId)
  const accountWorkingDays = normalizeAccountWorkingDays(
    account?.workingDays,
    account?.weekStartsOn === 0 ? 0 : 1
  )
  for (const { entity, row } of rows) {
    try {
      if (entity === 'allocations') {
        const allocation = row as unknown as Allocation
        const activity = dependencies.activities.find((item) => item.id === allocation.activityId)
        if (activity) assertScopedRefs(dependencies, accountId, 'activities', { ...activity })
        assertAllocationRefs(
          dependencies,
          accountId,
          allocation.resourceId,
          allocation.activityId,
          allocation.hoursPerDay,
          allocation.projectId
        )
        assertDateRange(allocation.startDate, allocation.endDate)
        const resource = dependencies.resources.find((item) => item.id === allocation.resourceId)!
        assertAllocationPlacement({ allocation, resource, accountWorkingDays })
      }
      if (entity === 'phases') assertScopedRefs(dependencies, accountId, 'phases', row)
      if (entity === 'timeOff')
        assertResourceExists(dependencies, accountId, String(row.resourceId))
    } catch {
      conflict()
    }
  }
  for (const { entity, row } of rows) {
    if (
      row.accountId !== accountId ||
      (await trx.from(TABLE_NAMES[entity]).where('id', String(row.id)).first())
    )
      conflict()
    await trx.table(TABLE_NAMES[entity]).insert(encodeRow(TABLE_NAMES[entity], row))
  }
  const current = await readStateWithClient(trx, accountId, true)
  for (const { entity, rowId, parentId } of links) {
    const field = entity === 'activities' ? 'phaseId' : 'disciplineId'
    const column = entity === 'activities' ? 'phase_id' : 'discipline_id'
    const child = current[entity].find((row) => row.id === rowId)
    const parent = current[entity === 'activities' ? 'phases' : 'disciplines'].find(
      (row) => row.id === parentId
    )
    if (!child || !parent || (child as unknown as Record<string, unknown>)[field] !== null)
      conflict()
    const candidate = { ...child, [field]: parentId }
    try {
      assertScopedRefs(current, accountId, entity, candidate, child)
    } catch {
      conflict()
    }
    await trx
      .from(TABLE_NAMES[entity])
      .where({ id: rowId, account_id: accountId })
      .whereNull(column)
      .update({ [column]: parentId, updated_at: createServerRevision(child.updatedAt) })
    Object.assign(child, candidate)
  }
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
