import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { allocationAttributionAllowed } from '@capacitylens/shared/lib/integrity'
import { cleanText } from '@capacitylens/shared/lib/strings'
import { DomainError } from '@capacitylens/shared/domain/errors'
import {
  archive,
  canUnarchive,
  LifecycleTransitionError,
  lifecycleStatus,
  unarchive,
} from '@capacitylens/shared/domain/lifecycle'
import type { AppData, AppDataKey } from '@capacitylens/shared/types/entities'
import { BatchRequestError } from '#services/batch/errors'
import { createServerRevision } from '#services/batch/revision'
import { encodeRow } from '#services/state_repository'
import { TABLE_NAMES } from '#services/batch/entity_policy'
import type { PlanningIntent, PlanningMutationSuccess } from '#validators/planning_operations'
import type { BatchCapabilities } from '#services/batch/data_policy'
import { existingRow, PlanningOperationError, updateSettings, writeRow } from './writer.js'
import { deleteAllocations, restoreGroup, type RestorationIdentity } from './restoration.js'
export { PlanningOperationError } from './writer.js'

type LifecycleTable = Extract<AppDataKey, 'clients' | 'projects' | 'resources' | 'activities'>

type GroupAllocation = Extract<
  PlanningIntent,
  { operation: 'allocation.createGroup' }
>['allocations'][number]

function allocationGroupShape(allocation: GroupAllocation) {
  return JSON.stringify({
    resourceId: allocation.resourceId,
    activityId: allocation.activityId,
    projectId: allocation.projectId ?? null,
    hoursPerDay: allocation.hoursPerDay,
    status: allocation.status,
    note:
      allocation.note === null || allocation.note === undefined
        ? null
        : cleanText(allocation.note, { multiline: true }),
    task:
      allocation.task === null || allocation.task === undefined ? null : cleanText(allocation.task),
    ignoreWeekends: allocation.ignoreWeekends === true,
  })
}

function assertAllocationGroupHomogeneous(allocations: readonly GroupAllocation[]) {
  const firstShape = allocationGroupShape(allocations[0]!)
  if (allocations.some((allocation) => allocationGroupShape(allocation) !== firstShape))
    throw new PlanningOperationError(
      400,
      'validation_error',
      'All allocations in a group must share the same allocation details.'
    )
}

async function transitionLifecycle(
  trx: TransactionClientContract,
  data: AppData,
  accountId: string,
  table: LifecycleTable,
  id: string,
  action: 'archive' | 'unarchive'
) {
  const current = existingRow(data, table, id)
  if (table === 'clients' && current.builtin === true)
    throw new PlanningOperationError(
      400,
      'validation_error',
      `The built-in Internal client cannot be ${action === 'archive' ? 'archived' : 'unarchived'}.`
    )
  const now = createServerRevision(current.updatedAt)
  let next: Record<string, unknown>
  if (action === 'archive') {
    next = {
      ...(archive(current as never, now) as unknown as Record<string, unknown>),
      updatedAt: now,
    }
  } else {
    if (!canUnarchive(current as never)) {
      const noChange = lifecycleStatus(current as never) === 'active'
      throw new PlanningOperationError(
        400,
        noChange ? 'no_change' : 'validation_error',
        noChange
          ? 'The record is already active.'
          : 'The record is not archived and cannot be unarchived.'
      )
    }
    next = {
      ...(unarchive(current as never) as unknown as Record<string, unknown>),
      updatedAt: now,
    }
  }
  await trx
    .from(TABLE_NAMES[table])
    .where({ id, account_id: accountId })
    .update(encodeRow(TABLE_NAMES[table], next))
  Object.assign(current, next)
}

/**
 * Applies one intent to the caller's transaction and mutable, complete company snapshot.
 * The caller retains a separate before-image and owns rollback, revision, audit and commitment.
 * Typed allocation deletes return a new restoration group; restore returns the group it consumed.
 */
export async function executePlanningIntent(
  trx: TransactionClientContract,
  accountId: string,
  intent: PlanningIntent,
  capabilities: BatchCapabilities,
  data: AppData,
  identity: RestorationIdentity
): Promise<PlanningMutationSuccess['restoration']> {
  const unchanged = { consumedGroupId: null, replacementGroupId: null }
  if (!capabilities.canWrite || capabilities.role === 'viewer')
    throw new PlanningOperationError(403, 'authorization_denied', 'Write access is required.')
  if (!data.accounts.some((row) => row.id === accountId))
    throw new PlanningOperationError(404, 'validation_error', 'The company was not found.')
  try {
    switch (intent.operation) {
      case 'allocation.create':
        await writeRow(
          trx,
          data,
          accountId,
          'allocations',
          intent.allocation.id,
          intent.allocation,
          capabilities,
          'create'
        )
        return unchanged
      case 'allocation.createGroup': {
        assertAllocationGroupHomogeneous(intent.allocations)
        const seriesId = crypto.randomUUID()
        for (const [index, allocation] of intent.allocations.entries()) {
          await writeRow(
            trx,
            data,
            accountId,
            'allocations',
            allocation.id,
            { ...allocation, seriesId },
            capabilities,
            'create',
            { permissiveRepeatStart: index > 0 }
          )
        }
        return unchanged
      }
      case 'allocation.update':
        await writeRow(
          trx,
          data,
          accountId,
          'allocations',
          intent.id,
          intent.changes,
          capabilities,
          'update'
        )
        return unchanged
      case 'allocation.duplicate':
      case 'allocation.repeat': {
        const source = existingRow(data, 'allocations', intent.sourceAllocationId)
        const occurrences =
          intent.operation === 'allocation.duplicate' ? [intent.occurrence] : intent.occurrences
        const seriesId = intent.operation === 'allocation.repeat' ? crypto.randomUUID() : null
        for (const [index, occurrence] of occurrences.entries()) {
          await writeRow(
            trx,
            data,
            accountId,
            'allocations',
            occurrence.id,
            {
              resourceId: source.resourceId,
              activityId: source.activityId,
              projectId: source.projectId,
              startDate: occurrence.startDate,
              endDate: occurrence.endDate,
              hoursPerDay: source.hoursPerDay,
              status: source.status,
              note: source.note,
              task: source.task,
              ignoreWeekends: source.ignoreWeekends,
              seriesId,
            },
            capabilities,
            'create',
            { permissiveRepeatStart: intent.operation === 'allocation.repeat' && index > 0 }
          )
        }
        return unchanged
      }
      case 'catalogue.create':
      case 'catalogue.update': {
        const entity = intent.entity
        const fields = 'fields' in entity ? entity.fields : entity.changes
        await writeRow(
          trx,
          data,
          accountId,
          entity.entity,
          entity.id,
          fields,
          capabilities,
          intent.operation === 'catalogue.create' ? 'create' : 'update'
        )
        if (entity.entity === 'activities' && intent.operation === 'catalogue.update') {
          const activity = existingRow(data, 'activities', entity.id)
          if (!allocationAttributionAllowed(activity.kind)) {
            for (const allocation of data.allocations) {
              if (allocation.activityId !== entity.id || allocation.projectId === null) continue
              await trx
                .from('allocations')
                .where({ id: allocation.id, account_id: accountId })
                .update({
                  project_id: null,
                  updated_at: createServerRevision(allocation.updatedAt),
                })
            }
          }
        }
        return unchanged
      }
      case 'catalogue.archive':
      case 'catalogue.unarchive':
        await transitionLifecycle(
          trx,
          data,
          accountId,
          intent.entity.entity,
          intent.entity.id,
          intent.operation === 'catalogue.archive' ? 'archive' : 'unarchive'
        )
        return unchanged
      case 'resource.create':
      case 'resource.update':
        await writeRow(
          trx,
          data,
          accountId,
          'resources',
          intent.id,
          intent.operation === 'resource.create' ? intent.fields : intent.changes,
          capabilities,
          intent.operation === 'resource.create' ? 'create' : 'update'
        )
        return unchanged
      case 'resource.archive':
      case 'resource.unarchive':
        await transitionLifecycle(
          trx,
          data,
          accountId,
          'resources',
          intent.id,
          intent.operation === 'resource.archive' ? 'archive' : 'unarchive'
        )
        return unchanged
      case 'timeOff.create':
        await writeRow(
          trx,
          data,
          accountId,
          'timeOff',
          intent.timeOff.id,
          intent.timeOff,
          capabilities,
          'create'
        )
        return unchanged
      case 'timeOff.update':
        await writeRow(
          trx,
          data,
          accountId,
          'timeOff',
          intent.id,
          intent.changes,
          capabilities,
          'update'
        )
        return unchanged
      case 'timeOff.repeat':
        for (const entry of intent.entries)
          await writeRow(trx, data, accountId, 'timeOff', entry.id, entry, capabilities, 'create')
        return unchanged
      case 'closure.create':
      case 'closure.update':
        await writeRow(
          trx,
          data,
          accountId,
          'closures',
          intent.id,
          intent.operation === 'closure.create' ? intent.fields : intent.changes,
          capabilities,
          intent.operation === 'closure.create' ? 'create' : 'update'
        )
        return unchanged
      case 'settings.update':
        await updateSettings(trx, data, accountId, intent.changes, capabilities)
        return unchanged
      case 'allocation.delete':
      case 'allocation.deleteGroup': {
        const ids = intent.operation === 'allocation.delete' ? [intent.id] : intent.ids
        const groupId = await deleteAllocations(trx, data, accountId, ids, identity)
        return { consumedGroupId: null, replacementGroupId: groupId }
      }
      case 'planning.restoreGroup':
        await restoreGroup(trx, accountId, intent.restorationGroupId, identity)
        return { consumedGroupId: intent.restorationGroupId, replacementGroupId: null }
      default:
        throw new PlanningOperationError(
          403,
          'authorization_denied',
          'This operation is unavailable.'
        )
    }
  } catch (error) {
    if (error instanceof PlanningOperationError) throw error
    if (error instanceof BatchRequestError)
      throw new PlanningOperationError(
        error.status,
        error.status === 403 ? 'authorization_denied' : 'validation_error',
        error.message
      )
    if (error instanceof DomainError)
      throw new PlanningOperationError(400, 'validation_error', error.message)
    if (error instanceof LifecycleTransitionError)
      throw new PlanningOperationError(
        400,
        error.code === 'already_inactive' ? 'no_change' : 'validation_error',
        error.message
      )
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'E_VALIDATION_ERROR' &&
      'messages' in error &&
      Array.isArray(error.messages)
    ) {
      const first = error.messages[0]
      throw new PlanningOperationError(
        400,
        'validation_error',
        typeof first?.message === 'string' ? first.message : 'The operation is invalid.'
      )
    }
    throw error
  }
}
