import type { PlanningIntent, PlanningMutationSuccess } from '@/api/planningContracts';
import { newId } from '@capacitylens/shared/lib/id';
import { APP_DATA_KEYS } from '@capacitylens/shared/types/entities';
import type { AppData, AppDataKey } from '@capacitylens/shared/types/entities';
import { PlanningControllerError } from './planningCacheController';
import {
  conflict,
  deleteRows,
  find,
  insert,
  lifecycle,
  patch,
  restore,
  rowId,
  rows,
} from './volatileRows';
import type { Group, Row } from './volatileRows';
import {
  validateCatalogue,
  validateClosure,
  validateResource,
  validateTimeOff,
} from './volatileValidation';

// Applies one typed planning intent to the demo rows and reports the rows it changed.

export function apply(
  data: AppData,
  companyId: string,
  intent: PlanningIntent,
  groups: Map<string, Group>,
) {
  let replacementGroupId: string | null = null;
  let consumedGroupId: string | null = null;
  let refetch = false;
  let clearsRestoration = false;
  switch (intent.operation) {
    case 'allocation.create':
      insert(data, 'allocations', rowId(intent.allocation.id), intent.allocation, companyId);
      break;
    case 'allocation.createGroup': {
      const seriesId = newId();
      for (const row of intent.allocations) {
        insert(data, 'allocations', rowId(row.id), { ...row, seriesId }, companyId);
      }
      break;
    }
    case 'allocation.update':
      patch(data, 'allocations', intent.id, intent.changes);
      break;
    case 'allocation.duplicate':
    case 'allocation.repeat': {
      const source = find(data, 'allocations', intent.sourceAllocationId);
      const occurrences =
        intent.operation === 'allocation.duplicate' ? [intent.occurrence] : intent.occurrences;
      const seriesId = intent.operation === 'allocation.repeat' ? newId() : null;
      for (const row of occurrences) {
        insert(data, 'allocations', row.id, { ...source, ...row, seriesId }, companyId);
      }
      break;
    }
    case 'allocation.delete':
    case 'allocation.deleteGroup':
      replacementGroupId = deleteRows(
        data,
        'allocations',
        intent.operation === 'allocation.delete' ? [intent.id] : intent.ids,
        groups,
      );
      break;
    case 'catalogue.create':
      validateCatalogue(data, companyId, intent.entity.entity, intent.entity.fields);
      insert(data, intent.entity.entity, intent.entity.id, intent.entity.fields, companyId);
      break;
    case 'catalogue.update': {
      const { entity, id, changes } = intent.entity;
      validateCatalogue(data, companyId, entity, changes, find(data, entity, id));
      const previous = { ...find(data, entity, id) };
      patch(data, entity, id, changes);
      const current = find(data, entity, id);
      const sensitiveFields =
        entity === 'activities'
          ? ['kind']
          : entity === 'clients' || entity === 'projects'
            ? ['isPrivate', 'codeName']
            : [];
      clearsRestoration = sensitiveFields.some(
        (field) => Object.hasOwn(changes, field) && previous[field] !== current[field],
      );
      refetch =
        ((entity === 'clients' || entity === 'projects') &&
          ('isPrivate' in changes || 'codeName' in changes)) ||
        (entity === 'activities' && 'kind' in changes);
      if (refetch && !Object.keys(changes).some((field) => previous[field] !== current[field])) {
        throw new PlanningControllerError(
          'The operation does not change planning data.',
          'NO_CHANGE',
          400,
        );
      }
      if (entity === 'activities' && 'kind' in changes && changes.kind !== 'project') {
        for (const row of rows(data, 'allocations')) {
          if (row.activityId === id && row.projectId !== null) {
            patch(data, 'allocations', row.id, { projectId: null });
          }
        }
      }
      break;
    }
    case 'catalogue.archive':
    case 'catalogue.unarchive':
      lifecycle(
        data,
        intent.entity.entity,
        intent.entity.id,
        intent.operation === 'catalogue.archive' ? 'archive' : 'unarchive',
      );
      break;
    case 'catalogue.delete':
      replacementGroupId = deleteRows(data, intent.entity.entity, [intent.entity.id], groups);
      break;
    case 'resource.create':
      validateResource(data, companyId, intent.fields);
      insert(data, 'resources', intent.id, intent.fields, companyId);
      break;
    case 'resource.update':
      validateResource(data, companyId, intent.changes, find(data, 'resources', intent.id));
      patch(data, 'resources', intent.id, intent.changes);
      break;
    case 'resource.archive':
    case 'resource.unarchive':
      lifecycle(
        data,
        'resources',
        intent.id,
        intent.operation === 'resource.archive' ? 'archive' : 'unarchive',
      );
      break;
    case 'timeOff.create':
      validateTimeOff(data, companyId, intent.timeOff);
      insert(data, 'timeOff', rowId(intent.timeOff.id), intent.timeOff, companyId);
      break;
    case 'timeOff.repeat':
      for (const row of intent.entries) {
        validateTimeOff(data, companyId, row);
        insert(data, 'timeOff', rowId(row.id), row, companyId);
      }
      break;
    case 'timeOff.update':
      validateTimeOff(data, companyId, intent.changes, find(data, 'timeOff', intent.id));
      patch(data, 'timeOff', intent.id, intent.changes);
      break;
    case 'timeOff.delete':
    case 'timeOff.deleteGroup':
      replacementGroupId = deleteRows(
        data,
        'timeOff',
        intent.operation === 'timeOff.delete' ? [intent.id] : intent.ids,
        groups,
      );
      break;
    case 'closure.create':
      validateClosure(intent.fields);
      insert(data, 'closures', intent.id, intent.fields, companyId);
      break;
    case 'closure.update':
      validateClosure(intent.changes, find(data, 'closures', intent.id));
      patch(data, 'closures', intent.id, intent.changes);
      break;
    case 'closure.delete':
      replacementGroupId = deleteRows(data, 'closures', [intent.id], groups);
      break;
    case 'settings.update':
      patch(data, 'accounts', companyId, intent.changes);
      break;
    case 'planning.restoreGroup': {
      const group = groups.get(intent.restorationGroupId);
      if (!group || group.companyId !== companyId) throw conflict();
      restore(data, group);
      consumedGroupId = intent.restorationGroupId;
      break;
    }
  }
  return { replacementGroupId, consumedGroupId, refetch, clearsRestoration };
}

export function changed(
  before: AppData,
  after: AppData,
): Extract<PlanningMutationSuccess['projection'], { mode: 'patch' }>['changed'] {
  const upserts: Array<{ entity: AppDataKey; row: Row }> = [];
  const removed: Array<{ entity: AppDataKey; id: string }> = [];
  for (const key of APP_DATA_KEYS) {
    const oldRows = new Map(rows(before, key).map((row) => [row.id, row]));
    const newRows = new Map(rows(after, key).map((row) => [row.id, row]));
    // apply() replaces only affected rows, so reference identity identifies exact upserts.
    for (const row of newRows.values()) {
      if (oldRows.get(row.id) !== row) upserts.push({ entity: key, row });
    }
    for (const row of oldRows.values()) {
      if (!newRows.has(row.id)) removed.push({ entity: key, id: row.id });
    }
  }
  return { upserts, removed } as unknown as Extract<
    PlanningMutationSuccess['projection'],
    { mode: 'patch' }
  >['changed'];
}
