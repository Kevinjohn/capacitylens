import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import {
  archive,
  canPurge,
  obfuscateResource,
  softDelete,
  unarchive,
} from '@capacitylens/shared/domain/lifecycle'
import { encodeRow, readStateWithClient } from '#services/state_repository'
import { BatchRequestError } from '#services/planning_operations/errors'
import { isLifecycle, isTable, TABLE_NAMES } from '#services/planning_operations/entity_policy'
import { writeAudit } from '#services/audit'
import type { BatchDataContext } from '#services/planning_operations/data_policy'
import { createServerRevision } from '#services/planning_operations/revision'
import { BatchStateProjection } from '#services/batch/projection'
import { APP_DATA_KEYS } from '@capacitylens/shared/types/entities'
import { redactPrivateName } from '@capacitylens/shared/domain/privateNames'
import { parseISOTimestamp } from '@capacitylens/shared/lib/integrity'
import { advancePlanningRevision } from '#services/planning_revision'

type Action = 'archive' | 'unarchive' | 'delete' | 'purge'

interface SurvivorRevision {
  id: string
  updated_at: unknown
}

async function clearAndRestamp(
  trx: TransactionClientContract,
  table: 'activities' | 'allocations' | 'resources',
  column: 'phase_id' | 'project_id',
  rows: readonly SurvivorRevision[]
) {
  for (const row of rows) {
    await trx
      .from(table)
      .where('id', row.id)
      .update({ [column]: null, updated_at: createServerRevision(row.updated_at) })
  }
}

async function restampPurgeSurvivors(
  trx: TransactionClientContract,
  entity: string,
  id: string,
  accountId: string
) {
  if (entity === 'projects') {
    const resources = await trx
      .from('resources')
      .select('id', 'updated_at')
      .where({ account_id: accountId, project_id: id })
    const allocations = await trx
      .from('allocations')
      .select('id', 'updated_at')
      .where({ account_id: accountId, project_id: id })
    const activities = await trx
      .from('activities')
      .select('activities.id', 'activities.updated_at')
      .join('phases', 'phases.id', 'activities.phase_id')
      .where('activities.account_id', accountId)
      .where('phases.project_id', id)
      .where((query) =>
        query.whereNull('activities.project_id').orWhereNot('activities.project_id', id)
      )
    await clearAndRestamp(trx, 'resources', 'project_id', resources)
    await clearAndRestamp(trx, 'activities', 'phase_id', activities)
    await clearAndRestamp(trx, 'allocations', 'project_id', allocations)
  } else if (entity === 'clients') {
    const projectIds = trx
      .from('projects')
      .select('id')
      .where({ account_id: accountId, client_id: id })
    const resources = await trx
      .from('resources')
      .select('id', 'updated_at')
      .where('account_id', accountId)
      .whereIn('project_id', projectIds.clone())
    const allocations = await trx
      .from('allocations')
      .select('id', 'updated_at')
      .where('account_id', accountId)
      .whereIn('project_id', projectIds.clone())
    const activities = await trx
      .from('activities')
      .select('activities.id', 'activities.updated_at')
      .join('phases', 'phases.id', 'activities.phase_id')
      .join('projects as phase_projects', 'phase_projects.id', 'phases.project_id')
      .where('activities.account_id', accountId)
      .where('phase_projects.client_id', id)
      .where((query) =>
        query
          .whereNull('activities.project_id')
          .orWhereNotIn('activities.project_id', projectIds.clone())
      )
    await clearAndRestamp(trx, 'resources', 'project_id', resources)
    await clearAndRestamp(trx, 'activities', 'phase_id', activities)
    await clearAndRestamp(trx, 'allocations', 'project_id', allocations)
  }
}

export async function applyLifecycle(
  trx: TransactionClientContract,
  entity: string,
  id: string,
  accountId: string,
  action: Action,
  context: BatchDataContext
) {
  const logAfterCommit = () => {
    trx.after('commit', () => context.logCommitted({ applied: 1, changed: 1 }))
  }
  const capabilities = context.capabilitiesFor(accountId)
  const policyAction = action === 'delete' || action === 'purge' ? 'purge' : 'write'
  if (!(await context.authorize(accountId, policyAction, capabilities)))
    throw new BatchRequestError('Forbidden.', 403)
  if (!isTable(entity) || !isLifecycle(entity))
    throw new BatchRequestError(`Unknown entity: ${entity}.`, 404)
  let repairedMalformedDeletion = false
  if (action === 'unarchive') {
    const persisted = await trx
      .from(TABLE_NAMES[entity])
      .select('archived_at', 'deleted_at')
      .where({ id, account_id: accountId })
      .first()
    if (
      persisted?.archived_at !== null &&
      persisted?.archived_at !== undefined &&
      typeof persisted.deleted_at === 'string' &&
      parseISOTimestamp(persisted.deleted_at) === null
    ) {
      await trx
        .from(TABLE_NAMES[entity])
        .where({ id, account_id: accountId })
        .update({ deleted_at: null })
      repairedMalformedDeletion = true
    }
  }
  const state = await readStateWithClient(trx, accountId, true)
  const row = (state[entity] as unknown as Array<Record<string, unknown>>).find(
    (item) => item.id === id
  )
  if (!row) throw new BatchRequestError('Not found.', 404)
  if (entity === 'clients' && row.builtin === true)
    throw new BatchRequestError(
      `The built-in Internal client cannot be ${
        action === 'delete' ? 'deleted' : action === 'purge' ? 'purged' : `${action}d`
      }.`,
      409,
      undefined,
      'protected_entity'
    )
  if (action === 'purge') {
    if (!canPurge(row as never, new Date().toISOString()))
      throw new BatchRequestError(
        'Cannot purge: must be a soft-deleted tombstone at least 30 days old.',
        409
      )
    const projection = new BatchStateProjection(state)
    const before = Object.fromEntries(APP_DATA_KEYS.map((table) => [table, state[table].length]))
    projection.delete(entity, id)
    const cascadeCounts = Object.fromEntries(
      APP_DATA_KEYS.flatMap((table) => {
        const removed = before[table] - state[table].length
        return removed > 0 ? [[table, removed]] : []
      })
    )
    await restampPurgeSurvivors(trx, entity, id, accountId)
    await trx.from(TABLE_NAMES[entity]).where({ id, account_id: accountId }).delete()
    await writeAudit(trx, {
      accountId,
      actorId: context.actorId,
      action: 'purge',
      entity,
      entityId: id,
      fields: [],
      cascadeCounts,
    })
    await advancePlanningRevision(trx, accountId)
    logAfterCommit()
    return null
  }
  const now = createServerRevision(row.updatedAt)
  const scrubbedFields: string[] = []
  let next: Record<string, unknown>
  if (action === 'archive')
    next = { ...(archive(row as never, now) as unknown as Record<string, unknown>), updatedAt: now }
  else if (action === 'unarchive')
    next = { ...(unarchive(row as never) as unknown as Record<string, unknown>), updatedAt: now }
  else {
    const tombstone = softDelete(row as never, now) as unknown as Record<string, unknown>
    const deleted = { ...tombstone, updatedAt: tombstone.deletedAt ?? now }
    next =
      entity === 'resources'
        ? (obfuscateResource(deleted as never) as unknown as Record<string, unknown>)
        : deleted
    if (entity === 'resources') {
      for (const table of ['allocations', 'time_off'] as const) {
        const noted = await trx
          .from(table)
          .select('id', 'updated_at')
          .where({ account_id: accountId, resource_id: id })
          .whereNotNull('note')
        if (noted.length > 0)
          scrubbedFields.push(table === 'time_off' ? 'timeOff.note' : 'allocations.note')
        for (const dependent of noted) {
          await trx
            .from(table)
            .where({ id: dependent.id, account_id: accountId })
            .update({ note: null, updated_at: createServerRevision(dependent.updated_at) })
        }
      }
    }
  }
  await trx
    .from(TABLE_NAMES[entity])
    .where({ id, account_id: accountId })
    .update(encodeRow(TABLE_NAMES[entity], next))
  const fields = [action === 'delete' ? 'deletedAt' : 'archivedAt']
  if (action === 'unarchive' && repairedMalformedDeletion) fields.push('deletedAt')
  if (action === 'delete' && entity === 'resources') {
    fields.push('name')
    fields.push(...scrubbedFields)
  }
  await writeAudit(trx, {
    accountId,
    actorId: context.actorId,
    action: action === 'delete' ? 'softDelete' : action,
    entity,
    entityId: id,
    fields,
  })
  await advancePlanningRevision(trx, accountId)
  logAfterCommit()
  return (entity === 'clients' || entity === 'projects') && !capabilities.canSeePrivateNames
    ? (redactPrivateName(next as never) as unknown as Record<string, unknown>)
    : next
}
