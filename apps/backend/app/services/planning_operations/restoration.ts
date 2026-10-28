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
import type { Allocation, AppData } from '@capacitylens/shared/types/entities'
import { readStateWithClient } from '#services/state_repository'
import { retainedQuery, isRetainedTable, type RetainedTable } from './retained_rows.js'
import { TABLE_NAMES } from '#services/planning_operations/entity_policy'
import { createServerRevision } from '#services/planning_operations/revision'
import { existingRow, PlanningOperationError } from './writer.js'

/** The identities that bind a restoration group to one actor's native session and mutation. */
export interface RestorationIdentity {
  actorId: string
  sessionId: number
  mutationId: string
}

type DeletableTable = RetainedTable
type SavedRow = { kind: 'row' }
type SavedLink = { kind: 'link'; parentId: string }

function conflict(): never {
  throw new PlanningOperationError(
    409,
    'restoration_conflict',
    'The deleted records can no longer be restored.'
  )
}

function affectedRows(result: number | unknown[]): number {
  return Array.isArray(result) ? result.length : result
}

/** Saves expected row identities and surviving-child links, then retains the deleted rows. */
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
  const links = rows.flatMap<{
    entity: 'activities' | 'resources'
    rowId: string
    parentId: string
  }>((row) =>
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
      payload_json: JSON.stringify({ kind: 'row' } satisfies SavedRow),
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
  for (const link of links) {
    const column = link.entity === 'activities' ? 'phase_id' : 'discipline_id'
    const detached = await trx
      .from(TABLE_NAMES[link.entity])
      .where({ id: link.rowId, account_id: accountId, [column]: link.parentId })
      .update({ [column]: null })
    if (affectedRows(detached) !== 1) conflict()
  }
  for (let start = 0; start < ids.length; start += 500) {
    const selected = ids.slice(start, start + 500)
    const deleted = await retainedQuery(trx, accountId, table).whereIn('id', selected).softDelete()
    if (deleted !== selected.length) conflict()
    const attached = await trx
      .from(TABLE_NAMES[table])
      .where('account_id', accountId)
      .whereIn('id', selected)
      .whereNotNull('deleted_at')
      .whereNull('deletion_group_id')
      .update({ deletion_group_id: groupId })
    if (affectedRows(attached) !== selected.length) conflict()
  }
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
    throw new PlanningOperationError(403, 'AUTHORIZATION_DENIED', 'This action is not allowed.')
  }
  const saved = await trx
    .from('deleted_rows')
    .where({ group_id: groupId })
    .select('entity', 'row_id', 'payload_json')
  const rows: Array<{ entity: DeletableTable; id: string; row: Record<string, unknown> }> = []
  const links: Array<{ entity: 'activities' | 'resources'; rowId: string; parentId: string }> = []
  for (const item of saved) {
    const payload = JSON.parse(String(item.payload_json)) as SavedRow | SavedLink
    if (payload.kind === 'row') {
      const entity = item.entity as DeletableTable
      if (!isRetainedTable(entity)) conflict()
      const stored = await retainedQuery(trx, accountId, entity)
        .onlyTrashed()
        .where('id', String(item.row_id))
        .where('deletion_group_id', groupId)
        .first()
      if (!stored) conflict()
      rows.push({ entity, id: String(item.row_id), row: stored.serialize() })
    } else
      links.push({
        entity: item.entity as 'activities' | 'resources',
        rowId: String(item.row_id),
        parentId: payload.parentId,
      })
  }
  if (rows.length === 0) conflict()
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
  for (const { entity, id, row } of rows) {
    if (row.accountId !== accountId || row.id !== id) conflict()
    const cleared = await trx
      .from(TABLE_NAMES[entity])
      .where({ id, account_id: accountId, deletion_group_id: groupId })
      .whereNotNull('deleted_at')
      .update({ deletion_group_id: null })
    if (affectedRows(cleared) !== 1) conflict()
    const restored = await retainedQuery(trx, accountId, entity)
      .onlyTrashed()
      .where('id', id)
      .whereNull('deletion_group_id')
      .restore()
    if (restored !== 1) conflict()
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

/**
 * Counts deleted records across every pending company group whose sign-in is still live;
 * surviving-child links are not items. An expired sign-in's groups wait only for pruning.
 */
export async function countRestorableItems(trx: TransactionClientContract, accountId: string) {
  const result = await trx
    .from('deleted_rows')
    .join('deleted_groups', 'deleted_groups.group_id', 'deleted_rows.group_id')
    .join('account_sessions', 'account_sessions.id', 'deleted_groups.session_id')
    .where('deleted_groups.account_id', accountId)
    .whereNull('deleted_groups.consumed_at')
    .where('account_sessions.expires_at', '>', new Date().toISOString())
    .whereRaw("json_extract(deleted_rows.payload_json, '$.kind') = ?", ['row'])
    .count('* as total')
    .first()
  return Number(result?.total ?? 0)
}

/** Carries only the count required for an explicit, revision-bound cleanup decision. */
export class RestorationConfirmationError extends PlanningOperationError {
  declare readonly code: 'RESTORATION_CONFIRMATION_REQUIRED' | 'RESTORATION_CONFIRMATION_STALE'

  constructor(
    readonly restorableItemCount: number,
    stale: boolean
  ) {
    super(
      409,
      stale ? 'RESTORATION_CONFIRMATION_STALE' : 'RESTORATION_CONFIRMATION_REQUIRED',
      stale
        ? 'The restorable items changed. Review this change again.'
        : `This change clears ${restorableItemCount} restorable ${restorableItemCount === 1 ? 'item' : 'items'}`
    )
  }
}
