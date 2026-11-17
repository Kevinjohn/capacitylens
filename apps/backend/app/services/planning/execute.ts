import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { allocationAttributionAllowed } from '@capacitylens/shared/lib/integrity';
import { cleanText } from '@capacitylens/shared/lib/strings';
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
import {
  deleteAllocations,
  deleteRows,
  restoreGroup,
  type RestorationIdentity,
} from './restoration.js';
export { PlanningOperationError } from './writer.js';

type LifecycleTable = Extract<AppDataKey, 'clients' | 'projects' | 'resources' | 'activities'>;

type GroupAllocation = Extract<
  PlanningIntent,
  { operation: 'allocation.createGroup' }
>['allocations'][number];

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
    ignoreWorkingDays: allocation.ignoreWorkingDays === true,
  });
}

function assertAllocationGroupHomogeneous(allocations: readonly GroupAllocation[]) {
  const first = allocations.at(0);
  if (!first) {
    throw new PlanningOperationError(
      400,
      'VALIDATION_ERROR',
      'An allocation group needs at least one allocation.'
    );
  }
  const firstShape = allocationGroupShape(first);
  if (allocations.some((allocation) => allocationGroupShape(allocation) !== firstShape)) {
    throw new PlanningOperationError(
      400,
      'VALIDATION_ERROR',
      'All allocations in a group must share the same allocation details.'
    );
  }
}

async function transitionLifecycle(
  trx: TransactionClientContract,
  data: AppData,
  accountId: string,
  table: LifecycleTable,
  id: string,
  action: 'archive' | 'unarchive'
) {
  const current = existingRow(data, table, id);
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
    .where({ id, account_id: accountId })
    .update(encodeRow(tables[table], next));
  Object.assign(current, next);
}

/** One planning intent and the verified context it is applied in. */
export interface ExecutePlanningIntentOptions {
  trx: TransactionClientContract;
  accountId: string;
  intent: PlanningIntent;
  capabilities: PlanningCapabilities;
  /** The mutable, complete company snapshot; the caller keeps its own before-image. */
  data: AppData;
  identity: RestorationIdentity;
}

/**
 * Applies one intent to the caller's transaction and mutable, complete company snapshot.
 * The caller retains a separate before-image and owns rollback, revision, audit and commitment.
 * Typed allocation deletes return a new restoration group; restore returns the group it consumed.
 */
export async function executePlanningIntent({
  trx,
  accountId,
  intent,
  capabilities,
  data,
  identity,
}: ExecutePlanningIntentOptions): Promise<PlanningMutationSuccess['restoration']> {
  const unchanged = { consumedGroupId: null, replacementGroupId: null };
  if (!capabilities.canWrite) {
    throw new PlanningOperationError(403, 'AUTHORIZATION_DENIED', 'Write access is required.');
  }
  if (!data.accounts.some((row) => row.id === accountId)) {
    throw new PlanningOperationError(400, 'VALIDATION_ERROR', 'The company was not found.');
  }
  const writeOptions = { trx, data, accountId, capabilities, identity };
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
        assertAllocationGroupHomogeneous(intent.allocations);
        const seriesId = crypto.randomUUID();
        for (const [index, allocation] of intent.allocations.entries()) {
          await writeEntity({
            ...writeOptions,
            table: 'allocations',
            id: allocation.id,
            fields: { ...allocation, seriesId },
            mode: 'create',
            permissiveRepeatStart: index > 0,
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
      case 'allocation.duplicate':
      case 'allocation.repeat': {
        const source = existingRow(data, 'allocations', intent.sourceAllocationId);
        const occurrences =
          intent.operation === 'allocation.duplicate' ? [intent.occurrence] : intent.occurrences;
        const seriesId = intent.operation === 'allocation.repeat' ? crypto.randomUUID() : null;
        for (const [index, occurrence] of occurrences.entries()) {
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
              seriesId,
            },
            mode: 'create',
            permissiveRepeatStart: intent.operation === 'allocation.repeat' && index > 0,
          });
        }
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
                .where({ id: allocation.id, account_id: accountId })
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
          accountId,
          intent.entity.entity,
          intent.entity.id,
          intent.operation === 'catalogue.archive' ? 'archive' : 'unarchive'
        );
        return unchanged;
      case 'catalogue.delete': {
        const groupId = await deleteRows(
          trx,
          data,
          accountId,
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
          accountId,
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
      case 'timeOff.repeat':
        for (const entry of intent.entries) {
          await writeEntity({
            ...writeOptions,
            table: 'timeOff',
            id: entry.id,
            fields: entry,
            mode: 'create',
          });
        }
        return unchanged;
      case 'timeOff.delete':
      case 'timeOff.deleteGroup': {
        const ids = intent.operation === 'timeOff.delete' ? [intent.id] : intent.ids;
        const groupId = await deleteRows(trx, data, accountId, 'timeOff', ids, identity);
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
        const groupId = await deleteRows(trx, data, accountId, 'closures', [intent.id], identity);
        return { consumedGroupId: null, replacementGroupId: groupId };
      }
      case 'settings.update':
        await updateSettings(trx, data, accountId, intent.changes, capabilities);
        return unchanged;
      case 'allocation.delete':
      case 'allocation.deleteGroup': {
        const ids = intent.operation === 'allocation.delete' ? [intent.id] : intent.ids;
        const groupId = await deleteAllocations(trx, data, accountId, ids, identity);
        return { consumedGroupId: null, replacementGroupId: groupId };
      }
      case 'planning.restoreGroup':
        await restoreGroup(trx, accountId, intent.restorationGroupId, identity);
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
