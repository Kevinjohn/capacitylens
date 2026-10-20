import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { allocationAttributionAllowed } from '@capacitylens/shared/lib/integrity'
import { DomainError } from '@capacitylens/shared/domain/errors'
import type { AppData } from '@capacitylens/shared/types/entities'
import { BatchRequestError } from '#services/batch/errors'
import { createServerRevision } from '#services/batch/revision'
import type { PlanningIntent } from '#validators/planning_operations'
import type { BatchCapabilities } from '#services/batch/data_policy'
import { existingRow, PlanningOperationError, updateSettings, writeRow } from './writer.js'
export { PlanningOperationError } from './writer.js'

/**
 * Applies one intent to the caller's transaction and mutable, complete company snapshot.
 * The caller retains a separate before-image and owns rollback, revision, audit and commitment.
 */
export async function executePlanningIntent(
  trx: TransactionClientContract,
  accountId: string,
  intent: PlanningIntent,
  capabilities: BatchCapabilities,
  data: AppData
): Promise<void> {
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
        return
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
        return
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
        return
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
        return
      }
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
        return
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
        return
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
        return
      case 'timeOff.repeat':
        for (const entry of intent.entries)
          await writeRow(trx, data, accountId, 'timeOff', entry.id, entry, capabilities, 'create')
        return
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
        return
      case 'settings.update':
        await updateSettings(trx, data, accountId, intent.changes, capabilities)
        return
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
