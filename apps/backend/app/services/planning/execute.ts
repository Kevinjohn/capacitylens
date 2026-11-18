import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { allocationAttributionAllowed } from '@capacitylens/shared/lib/integrity';
import { DomainError } from '@capacitylens/shared/domain/errors';
import {
  archive,
  canUnarchive,
  LifecycleTransitionError,
  lifecycleStatus,
  unarchive,
} from '@capacitylens/shared/domain/lifecycle';
import type { AppData, AppDataKey, Client } from '@capacitylens/shared/types/entities';
import { EntityWriteError } from '#services/planning/errors';
import { createServerRevision } from '#services/planning/server_timestamp';
import { encodeRow } from '#services/state_repository';
import { tables } from '#services/product_tables';
import type { PlanningIntent, PlanningMutationSuccess } from '#validators/planning/contracts';
import type { PlanningCapabilities } from '#services/planning/data_policy';
import { existingRow, PlanningOperationError, updateSettings } from './writer.js';
import { writeEntity } from './entity_write.js';
import { buildAllocationOccurrences, buildTimeOffOccurrences } from './repeat_occurrences.js';
import {
  deleteAllocations,
  deleteRows,
  restoreGroup,
  type RestorationIdentity,
} from './restoration.js';
export { PlanningOperationError } from './writer.js';

type LifecycleTable = Extract<AppDataKey, 'clients' | 'projects' | 'resources' | 'activities'>;

/** A repeat names one id per later occurrence; a different count means the client's repeat differs. */
function assertOccurrenceIdsMatch(occurrenceIds: readonly string[], later: readonly unknown[]) {
  if (occurrenceIds.length !== later.length) {
    throw new PlanningOperationError(
      400,
      'VALIDATION_ERROR',
      'The occurrence identities do not match the repeat.'
    );
  }
}

async function transitionLifecycle(
  trx: TransactionClientContract,
  data: AppData,
  companyId: string,
  table: LifecycleTable,
  id: string,
  action: 'archive' | 'unarchive'
) {
  const current = existingRow(data, table, id);
  // Checking the table does not narrow the row, but a clients row is a Client.
  if (table === 'clients' && (current as Client).builtin === true) {
    throw new PlanningOperationError(
      409,
      null,
      `The built-in Internal client cannot be ${action === 'archive' ? 'archived' : 'unarchived'}.`
    );
  }
  const now = createServerRevision(current.updatedAt);
  let next: Record<string, unknown>;
  if (action === 'archive') {
    next = {
      ...archive(current, now),
      updatedAt: now,
    };
  } else {
    if (!canUnarchive(current)) {
      const noChange = lifecycleStatus(current) === 'active';
      throw new PlanningOperationError(
        400,
        noChange ? 'NO_CHANGE' : 'VALIDATION_ERROR',
        noChange
          ? 'The record is already active.'
          : 'The record is not archived and cannot be unarchived.'
      );
    }
    next = {
      ...unarchive(current),
      updatedAt: now,
    };
  }
  await trx
    .from(tables[table])
    .where({ id, company_id: companyId })
    .update(encodeRow(tables[table], next));
  Object.assign(current, next);
}

/** One planning intent and the verified context it is applied in. */
export interface ExecutePlanningIntentOptions {
  trx: TransactionClientContract;
  companyId: string;
  intent: PlanningIntent;
  capabilities: PlanningCapabilities;
  /** The mutable, complete company snapshot; the caller keeps its own before-image. */
  data: AppData;
  identity: RestorationIdentity;
  /** The edited row's `updatedAt` when its form opened; only single-row updates check it. */
  expectedUpdatedAt?: string;
}

/**
 * Applies one intent to the caller's transaction and mutable, complete company snapshot.
 * The caller retains a separate before-image and owns rollback, revision, audit and commitment.
 * Typed allocation deletes return a new restoration group; restore returns the group it consumed.
 */
export async function executePlanningIntent({
  trx,
  companyId,
  intent,
  capabilities,
  data,
  identity,
  expectedUpdatedAt,
}: ExecutePlanningIntentOptions): Promise<PlanningMutationSuccess['restoration']> {
  const unchanged = { consumedGroupId: null, replacementGroupId: null };
  if (!capabilities.canWrite) {
    throw new PlanningOperationError(403, 'AUTHORIZATION_DENIED', 'Write access is required.');
  }
  if (!data.accounts.some((row) => row.id === companyId)) {
    throw new PlanningOperationError(400, 'VALIDATION_ERROR', 'The company was not found.');
  }
  const writeOptions = { trx, data, companyId, capabilities, identity, expectedUpdatedAt };
  try {
    switch (intent.operation) {
      case 'allocation.create':
        await writeEntity({
          ...writeOptions,
          table: 'allocations',
          id: intent.allocation.id,
          fields: intent.allocation,
          mode: 'create',
        });
        return unchanged;
      case 'allocation.createGroup': {
        const { allocation, repeat, occurrenceIds } = intent;
        const seriesId = crypto.randomUUID();
        // The first occurrence is the allocation as sent, so its write refuses what a create refuses.
        await writeEntity({
          ...writeOptions,
          table: 'allocations',
          id: allocation.id,
          fields: { ...allocation, seriesId },
          mode: 'create',
        });
        const later = buildAllocationOccurrences(data, companyId, allocation, repeat).slice(1);
        assertOccurrenceIdsMatch(occurrenceIds, later);
        for (const [index, { startDate, endDate }] of later.entries()) {
          const id = occurrenceIds[index] as string;
          await writeEntity({
            ...writeOptions,
            table: 'allocations',
            id,
            fields: { ...allocation, id, startDate, endDate, seriesId },
            mode: 'create',
            permissiveRepeatStart: true,
          });
        }
        return unchanged;
      }
      case 'allocation.update':
        await writeEntity({
          ...writeOptions,
          table: 'allocations',
          id: intent.id,
          fields: intent.changes,
          mode: 'update',
        });
        return unchanged;
      case 'allocation.duplicate': {
        const source = existingRow(data, 'allocations', intent.sourceAllocationId);
        const { occurrence } = intent;
        await writeEntity({
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
        });
        return unchanged;
      }
      case 'catalogue.create':
      case 'catalogue.update': {
        const entity = intent.entity;
        const fields = 'fields' in entity ? entity.fields : entity.changes;
        await writeEntity({
          ...writeOptions,
          table: entity.entity,
          id: entity.id,
          fields,
          mode: intent.operation === 'catalogue.create' ? 'create' : 'update',
        });
        if (entity.entity === 'activities' && intent.operation === 'catalogue.update') {
          const activity = existingRow(data, 'activities', entity.id);
          if (!allocationAttributionAllowed(activity.kind)) {
            for (const allocation of data.allocations) {
              if (allocation.activityId !== entity.id || allocation.projectId === null) continue;
              await trx
                .from('allocations')
                .where({ id: allocation.id, company_id: companyId })
                .update({
                  project_id: null,
                  updated_at: createServerRevision(allocation.updatedAt),
                });
            }
          }
        }
        return unchanged;
      }
      case 'catalogue.archive':
      case 'catalogue.unarchive':
        await transitionLifecycle(
          trx,
          data,
          companyId,
          intent.entity.entity,
          intent.entity.id,
          intent.operation === 'catalogue.archive' ? 'archive' : 'unarchive'
        );
        return unchanged;
      case 'catalogue.delete': {
        const groupId = await deleteRows(
          trx,
          data,
          companyId,
          intent.entity.entity,
          [intent.entity.id],
          identity
        );
        return { consumedGroupId: null, replacementGroupId: groupId };
      }
      case 'resource.create':
      case 'resource.update':
        await writeEntity({
          ...writeOptions,
          table: 'resources',
          id: intent.id,
          fields: intent.operation === 'resource.create' ? intent.fields : intent.changes,
          mode: intent.operation === 'resource.create' ? 'create' : 'update',
        });
        return unchanged;
      case 'resource.archive':
      case 'resource.unarchive':
        await transitionLifecycle(
          trx,
          data,
          companyId,
          'resources',
          intent.id,
          intent.operation === 'resource.archive' ? 'archive' : 'unarchive'
        );
        return unchanged;
      case 'timeOff.create':
        await writeEntity({
          ...writeOptions,
          table: 'timeOff',
          id: intent.timeOff.id,
          fields: intent.timeOff,
          mode: 'create',
        });
        return unchanged;
      case 'timeOff.update':
        await writeEntity({
          ...writeOptions,
          table: 'timeOff',
          id: intent.id,
          fields: intent.changes,
          mode: 'update',
        });
        return unchanged;
      case 'timeOff.repeat': {
        const { timeOff, repeat, occurrenceIds } = intent;
        // The first occurrence is the entry as sent, so its write refuses what a create refuses.
        await writeEntity({
          ...writeOptions,
          table: 'timeOff',
          id: timeOff.id,
          fields: timeOff,
          mode: 'create',
        });
        const later = buildTimeOffOccurrences(timeOff, repeat).slice(1);
        assertOccurrenceIdsMatch(occurrenceIds, later);
        for (const [index, { startDate, endDate }] of later.entries()) {
          const id = occurrenceIds[index] as string;
          await writeEntity({
            ...writeOptions,
            table: 'timeOff',
            id,
            fields: { ...timeOff, id, startDate, endDate },
            mode: 'create',
          });
        }
        return unchanged;
      }
      case 'timeOff.delete':
      case 'timeOff.deleteGroup': {
        const ids = intent.operation === 'timeOff.delete' ? [intent.id] : intent.ids;
        const groupId = await deleteRows(trx, data, companyId, 'timeOff', ids, identity);
        return { consumedGroupId: null, replacementGroupId: groupId };
      }
      case 'closure.create':
      case 'closure.update':
        await writeEntity({
          ...writeOptions,
          table: 'closures',
          id: intent.id,
          fields: intent.operation === 'closure.create' ? intent.fields : intent.changes,
          mode: intent.operation === 'closure.create' ? 'create' : 'update',
        });
        return unchanged;
      case 'closure.delete': {
        const groupId = await deleteRows(trx, data, companyId, 'closures', [intent.id], identity);
        return { consumedGroupId: null, replacementGroupId: groupId };
      }
      case 'settings.update':
        await updateSettings(trx, data, companyId, intent.changes, capabilities);
        return unchanged;
      case 'allocation.delete':
      case 'allocation.deleteGroup': {
        const ids = intent.operation === 'allocation.delete' ? [intent.id] : intent.ids;
        const groupId = await deleteAllocations(trx, data, companyId, ids, identity);
        return { consumedGroupId: null, replacementGroupId: groupId };
      }
      case 'planning.restoreGroup':
        await restoreGroup(trx, companyId, intent.restorationGroupId, identity);
        return { consumedGroupId: intent.restorationGroupId, replacementGroupId: null };
      default:
        throw new PlanningOperationError(
          403,
          'AUTHORIZATION_DENIED',
          'This operation is unavailable.'
        );
    }
  } catch (error) {
    if (error instanceof PlanningOperationError) throw error;
    if (error instanceof EntityWriteError) {
      throw error.status === 403
        ? new PlanningOperationError(403, 'AUTHORIZATION_DENIED', error.message)
        : new PlanningOperationError(400, 'VALIDATION_ERROR', error.message);
    }
    if (error instanceof DomainError) {
      throw new PlanningOperationError(400, 'VALIDATION_ERROR', error.message);
    }
    if (error instanceof LifecycleTransitionError) {
      throw new PlanningOperationError(
        400,
        error.code === 'already_inactive' ? 'NO_CHANGE' : 'VALIDATION_ERROR',
        error.message
      );
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'E_VALIDATION_ERROR' &&
      'messages' in error &&
      Array.isArray(error.messages)
    ) {
      const first = error.messages[0];
      throw new PlanningOperationError(
        400,
        'VALIDATION_ERROR',
        typeof first?.message === 'string' ? first.message : 'The operation is invalid.'
      );
    }
    throw error;
  }
}
