import { inject } from '@adonisjs/core'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { isAllocationAttributionAllowed } from '@capacitylens/shared/lib/integrity'
import { errors as vineErrors } from '@vinejs/vine'
import { DomainError } from '@capacitylens/shared/domain/errors'
import {
  archive,
  canRestore,
  LifecycleTransitionError,
  resolveLifecycleStatus,
  restore,
} from '@capacitylens/shared/domain/lifecycle'
import type { AppData, AppDataKey, Client } from '@capacitylens/shared/types/entities'
import { hasHourlyLoad } from '@capacitylens/shared/types/entities'
import { reconcileReassignedHours } from '@capacitylens/shared/domain/placement'
import { normalizeCompanyWorkingDays } from '@capacitylens/shared/lib/companyWorkingDays'
import { resolveEffectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek'
import { createServerRevision } from '#services/planning/server_timestamp'
import Allocation from '#models/allocation'
import { productModels } from '#services/models/product_models'
import { rowAttributes } from '#services/models/row_attributes'
import type { PlanningIntent, PlanningMutationSuccess } from '#validators/planning/contracts'
import type { PlanningAccessGrant } from '#services/planning/access_grant'
import { requireExistingRow, type WrittenRow } from '#services/planning/writer'
import { PlanningWriterService } from '#services/planning/planning_writer_service'
import { EntityWriteService } from '#services/planning/entity_write_service'
import {
  buildAllocationOccurrences,
  buildTimeOffOccurrences,
} from '#services/planning/repeat_occurrences'
import {
  RestorationService,
  type RestorationIdentity,
} from '#services/planning/restoration_service'
import ValidationRefusalException from '#exceptions/validation_refusal_exception'
import PlanningOperationException from '#exceptions/planning_operation_exception'
import PlanningAuthorizationException from '#exceptions/planning_authorization_exception'
import NoChangeException from '#exceptions/no_change_exception'
import PlanningConflictException from '#exceptions/planning_conflict_exception'
import EntityWriteException from '#exceptions/entity_write_exception'

type LifecycleTable = Extract<AppDataKey, 'clients' | 'projects' | 'resources' | 'activities'>

/** A repeat names one id per later occurrence; a different count means the client's repeat differs. */
function assertOccurrenceIdsMatch(occurrenceIds: readonly string[], later: readonly unknown[]) {
  if (occurrenceIds.length !== later.length) {
    throw new ValidationRefusalException('The occurrence identities do not match the repeat.')
  }
}

/** The occurrence and every later one in its repeat series, read from the server's snapshot. */
function resolveSeriesFrom(data: AppData, id: string): string[] {
  const target = requireExistingRow(data, 'allocations', id)
  const { seriesId, startDate } = target
  if (!seriesId) {
    throw new ValidationRefusalException('This allocation is not part of a repeat series.')
  }
  return data.allocations
    .filter((row) => row.seriesId === seriesId && row.startDate >= startDate)
    .map((row) => row.id)
}

/** One planning intent and the verified context it is applied in. */
export interface ExecutePlanningIntentOptions {
  trx: TransactionClientContract
  companyId: string
  intent: PlanningIntent
  accessGrant: PlanningAccessGrant
  /** The mutable, complete company snapshot; the caller keeps its own before-image. */
  data: AppData
  identity: RestorationIdentity
  /** The edited row's `updatedAt` when its form opened; only single-row updates check it. */
  expectedUpdatedAt?: string
}

/** What one executed intent did: its restoration handles and every product row it wrote. */
export interface PlanningExecution {
  restoration: PlanningMutationSuccess['restoration']
  written: WrittenRow[]
  /** The intent as committed: a repeat also names the occurrence ids the server minted. */
  intent: PlanningIntent
}

/** Planning intents applied in the caller's transaction. */
@inject()
export class PlanningExecutionService {
  #writer: PlanningWriterService
  #entityWrites: EntityWriteService
  #restoration: RestorationService

  constructor(
    writer: PlanningWriterService,
    entityWrites: EntityWriteService,
    restoration: RestorationService
  ) {
    this.#writer = writer
    this.#entityWrites = entityWrites
    this.#restoration = restoration
  }

  /**
   * Applies one intent to the caller's transaction and mutable, complete company snapshot.
   * The caller retains a separate before-image and owns rollback, revision, audit and commitment.
   * Typed allocation deletes return a new restoration group; restore returns the group it consumed.
   */
  async executePlanningIntent(options: ExecutePlanningIntentOptions): Promise<PlanningExecution> {
    const written: WrittenRow[] = []
    const committed = { intent: options.intent }
    const restoration = await this.#applyIntent(options, written, committed)
    return { restoration, written, intent: committed.intent }
  }

  async #applyIntent(
    {
      trx,
      companyId,
      intent,
      accessGrant,
      data,
      identity,
      expectedUpdatedAt,
    }: ExecutePlanningIntentOptions,
    written: WrittenRow[],
    committed: { intent: PlanningIntent }
  ): Promise<PlanningMutationSuccess['restoration']> {
    const unchanged = { consumedGroupId: null, replacementGroupId: null }
    if (!accessGrant.canWrite) {
      throw new PlanningAuthorizationException('Write access is required.')
    }
    if (!data.companies.some((row) => row.id === companyId)) {
      throw new ValidationRefusalException('The company was not found.')
    }
    const writeOptions = {
      trx,
      data,
      written,
      companyId,
      accessGrant,
      identity,
      expectedUpdatedAt,
    }
    try {
      switch (intent.operation) {
        case 'allocation.create':
          await this.#entityWrites.writeEntity({
            ...writeOptions,
            table: 'allocations',
            id: intent.allocation.id,
            fields: intent.allocation,
            mode: 'create',
          })
          return unchanged
        case 'allocation.createGroup': {
          const { allocation, repeat } = intent
          const seriesId = crypto.randomUUID()
          // The first occurrence is the allocation as sent, so its write refuses what a create refuses.
          await this.#entityWrites.writeEntity({
            ...writeOptions,
            table: 'allocations',
            id: allocation.id,
            fields: { ...allocation, seriesId },
            mode: 'create',
          })
          const later = buildAllocationOccurrences(data, companyId, allocation, repeat).slice(1)
          // A redo replays the ids minted when the repeat was first committed.
          const occurrenceIds = intent.occurrenceIds ?? later.map(() => crypto.randomUUID())
          assertOccurrenceIdsMatch(occurrenceIds, later)
          committed.intent = { ...intent, occurrenceIds }
          for (const [index, { startDate, endDate }] of later.entries()) {
            const id = occurrenceIds[index] as string
            await this.#entityWrites.writeEntity({
              ...writeOptions,
              table: 'allocations',
              id,
              fields: { ...allocation, id, startDate, endDate, seriesId },
              mode: 'create',
              permissiveRepeatStart: true,
            })
          }
          return unchanged
        }
        case 'allocation.update':
          await this.#entityWrites.writeEntity({
            ...writeOptions,
            table: 'allocations',
            id: intent.id,
            fields: intent.changes,
            mode: 'update',
          })
          return unchanged
        case 'allocation.reassign': {
          const { id, resourceId, startDate, endDate } = intent
          const existing = requireExistingRow(data, 'allocations', id)
          const target = requireExistingRow(data, 'resources', resourceId)
          const company = requireExistingRow(data, 'companies', companyId)
          const hoursPerDay = reconcileReassignedHours({
            current: existing.hoursPerDay,
            target,
            zeroLoadMode: !hasHourlyLoad(company.schedulingMode ?? 'hourly'),
            startDate,
            effectiveWeek: resolveEffectiveWorkingWeek(
              target,
              normalizeCompanyWorkingDays(company.workingDays, company.weekStartsOn === 0 ? 0 : 1)
            ),
          })
          await this.#entityWrites.writeEntity({
            ...writeOptions,
            table: 'allocations',
            id,
            fields: {
              resourceId,
              startDate,
              endDate,
              ...(hoursPerDay === existing.hoursPerDay ? {} : { hoursPerDay }),
            },
            mode: 'update',
          })
          return unchanged
        }
        case 'allocation.duplicate': {
          const source = requireExistingRow(data, 'allocations', intent.sourceAllocationId)
          const { occurrence } = intent
          await this.#entityWrites.writeEntity({
            ...writeOptions,
            table: 'allocations',
            id: occurrence.id,
            fields: {
              resourceId: source.resourceId,
              activityId: source.activityId,
              projectId: source.projectId,
              startDate: occurrence.startDate,
              endDate: occurrence.endDate,
              hoursPerDay: source.hoursPerDay,
              status: source.status,
              note: source.note,
              task: source.task,
              ignoreWorkingDays: source.ignoreWorkingDays,
              seriesId: null,
            },
            mode: 'create',
          })
          return unchanged
        }
        case 'catalogue.create':
        case 'catalogue.update': {
          const entity = intent.entity
          const fields = 'fields' in entity ? entity.fields : entity.changes
          await this.#entityWrites.writeEntity({
            ...writeOptions,
            table: entity.entity,
            id: entity.id,
            fields,
            mode: intent.operation === 'catalogue.create' ? 'create' : 'update',
          })
          if (entity.entity === 'activities' && intent.operation === 'catalogue.update') {
            const activity = requireExistingRow(data, 'activities', entity.id)
            if (!isAllocationAttributionAllowed(activity.kind)) {
              for (const allocation of data.allocations) {
                if (allocation.activityId !== entity.id || allocation.projectId === null) continue
                const updatedAt = createServerRevision(allocation.updatedAt)
                // A builder update skips column prepare, so updatedAt goes in as its stored ISO string.
                await Allocation.query({ client: trx })
                  .withScopes((scopes) => scopes.forCompany(companyId))
                  .where('id', allocation.id)
                  .update({ projectId: null, updatedAt })
                const before = { ...allocation }
                Object.assign(allocation, { projectId: null, updatedAt })
                written.push({
                  entity: 'allocations',
                  id: allocation.id,
                  before,
                  after: { ...allocation },
                })
              }
            }
          }
          return unchanged
        }
        case 'catalogue.archive':
        case 'catalogue.restore':
          await this.#transitionLifecycle(
            trx,
            data,
            intent.entity.entity,
            intent.entity.id,
            intent.operation === 'catalogue.archive' ? 'archive' : 'restore',
            written
          )
          return unchanged
        case 'catalogue.delete': {
          const groupId = await this.#restoration.deleteRows(
            trx,
            data,
            companyId,
            intent.entity.entity,
            [intent.entity.id],
            identity,
            written
          )
          return { consumedGroupId: null, replacementGroupId: groupId }
        }
        case 'resource.create':
        case 'resource.update':
          await this.#entityWrites.writeEntity({
            ...writeOptions,
            table: 'resources',
            id: intent.id,
            fields: intent.operation === 'resource.create' ? intent.fields : intent.changes,
            mode: intent.operation === 'resource.create' ? 'create' : 'update',
          })
          return unchanged
        case 'resource.archive':
        case 'resource.restore':
          await this.#transitionLifecycle(
            trx,
            data,
            'resources',
            intent.id,
            intent.operation === 'resource.archive' ? 'archive' : 'restore',
            written
          )
          return unchanged
        case 'timeOff.create':
          await this.#entityWrites.writeEntity({
            ...writeOptions,
            table: 'timeOff',
            id: intent.timeOff.id,
            fields: intent.timeOff,
            mode: 'create',
          })
          return unchanged
        case 'timeOff.update':
          await this.#entityWrites.writeEntity({
            ...writeOptions,
            table: 'timeOff',
            id: intent.id,
            fields: intent.changes,
            mode: 'update',
          })
          return unchanged
        case 'timeOff.repeat': {
          const { timeOff, repeat, occurrenceIds } = intent
          // The first occurrence is the entry as sent, so its write refuses what a create refuses.
          await this.#entityWrites.writeEntity({
            ...writeOptions,
            table: 'timeOff',
            id: timeOff.id,
            fields: timeOff,
            mode: 'create',
          })
          const later = buildTimeOffOccurrences(timeOff, repeat).slice(1)
          assertOccurrenceIdsMatch(occurrenceIds, later)
          for (const [index, { startDate, endDate }] of later.entries()) {
            const id = occurrenceIds[index] as string
            await this.#entityWrites.writeEntity({
              ...writeOptions,
              table: 'timeOff',
              id,
              fields: { ...timeOff, id, startDate, endDate },
              mode: 'create',
            })
          }
          return unchanged
        }
        case 'timeOff.delete':
        case 'timeOff.deleteGroup': {
          const ids = intent.operation === 'timeOff.delete' ? [intent.id] : intent.ids
          const groupId = await this.#restoration.deleteRows(
            trx,
            data,
            companyId,
            'timeOff',
            ids,
            identity,
            written
          )
          return { consumedGroupId: null, replacementGroupId: groupId }
        }
        case 'closure.create':
        case 'closure.update':
          await this.#entityWrites.writeEntity({
            ...writeOptions,
            table: 'closures',
            id: intent.id,
            fields: intent.operation === 'closure.create' ? intent.fields : intent.changes,
            mode: intent.operation === 'closure.create' ? 'create' : 'update',
          })
          return unchanged
        case 'closure.delete': {
          const groupId = await this.#restoration.deleteRows(
            trx,
            data,
            companyId,
            'closures',
            [intent.id],
            identity,
            written
          )
          return { consumedGroupId: null, replacementGroupId: groupId }
        }
        case 'settings.update':
          await this.#writer.updateSettings(
            trx,
            data,
            companyId,
            intent.changes,
            accessGrant,
            written
          )
          return unchanged
        case 'allocation.delete':
        case 'allocation.deleteGroup': {
          const ids =
            intent.operation === 'allocation.deleteGroup'
              ? intent.ids
              : intent.scope === 'future'
                ? resolveSeriesFrom(data, intent.id)
                : [intent.id]
          const groupId = await this.#restoration.deleteAllocations(
            trx,
            data,
            companyId,
            ids,
            identity,
            written
          )
          return { consumedGroupId: null, replacementGroupId: groupId }
        }
        case 'planning.restoreGroup':
          await this.#restoration.restoreGroup(
            trx,
            data,
            companyId,
            intent.restorationGroupId,
            identity,
            written
          )
          return { consumedGroupId: intent.restorationGroupId, replacementGroupId: null }
        default:
          throw new PlanningAuthorizationException('This operation is unavailable.')
      }
    } catch (error) {
      if (
        error instanceof PlanningOperationException ||
        error instanceof ValidationRefusalException
      ) {
        throw error
      }
      if (error instanceof EntityWriteException) {
        throw error.status === 403
          ? new PlanningAuthorizationException(error.message)
          : new ValidationRefusalException(error.message)
      }
      if (error instanceof DomainError) {
        throw new ValidationRefusalException(error.message)
      }
      if (error instanceof LifecycleTransitionError) {
        throw error.code === 'already_inactive'
          ? new NoChangeException(error.message)
          : new ValidationRefusalException(error.message)
      }
      if (error instanceof vineErrors.E_VALIDATION_ERROR) {
        const first = error.messages[0]
        throw new ValidationRefusalException(
          typeof first?.message === 'string' ? first.message : 'The operation is invalid.'
        )
      }
      throw error
    }
  }

  async #transitionLifecycle(
    trx: TransactionClientContract,
    data: AppData,
    table: LifecycleTable,
    id: string,
    action: 'archive' | 'restore',
    written: WrittenRow[]
  ) {
    const current = requireExistingRow(data, table, id)
    // Checking the table does not narrow the row, but a clients row is a Client.
    if (table === 'clients' && (current as Client).builtin === true) {
      throw new PlanningConflictException(
        `The built-in Internal client cannot be ${action === 'archive' ? 'archived' : 'restored'}.`
      )
    }
    const now = createServerRevision(current.updatedAt)
    let next: Record<string, unknown>
    if (action === 'archive') {
      next = {
        ...archive(current, now),
        updatedAt: now,
      }
    } else {
      if (!canRestore(current)) {
        if (resolveLifecycleStatus(current) === 'active') {
          throw new NoChangeException('The record is already active.')
        }
        throw new ValidationRefusalException('The record is not archived and cannot be restored.')
      }
      next = {
        ...restore(current),
        updatedAt: now,
      }
    }
    const model = productModels[table]
    await this.#writer.snapshotRow(model, current, trx).merge(rowAttributes(model, next)).save()
    const before = { ...current, id }
    Object.assign(current, next)
    written.push({ entity: table, id, before, after: { ...current, id } })
  }
}
