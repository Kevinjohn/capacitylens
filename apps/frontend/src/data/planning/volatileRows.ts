import { newId } from '@capacitylens/shared/lib/id';
import { SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import type { AppData, AppDataKey } from '@capacitylens/shared/types/entities';
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields';
import { archive, unarchive } from '@capacitylens/shared/domain/lifecycle';
import {
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertScopedRefs,
} from '@capacitylens/shared/domain/mutations';
import { DomainError } from '@capacitylens/shared/domain/errors';
import { assertAllocationPlacement } from '@capacitylens/shared/domain/placement';
import { normalizeAccountWorkingDays } from '@capacitylens/shared/lib/accountWorkingDays';
import { NEUTRAL_COLOR, isPresetColor, snapToPresetColor } from '@capacitylens/shared/lib/color';
import type { Allocation } from '@capacitylens/shared/types/entities';
import { stamp, touchAfter } from '@/store/revisions';
import { PlanningControllerError } from './planningCacheController';

// The demo transport's in-memory rows: reading, writing, deleting into restorable groups and restoring.

export type Row = { id: string; updatedAt: string; [field: string]: unknown };
type Link = {
  key: 'resources' | 'activities';
  id: string;
  field: 'disciplineId' | 'phaseId';
  parentId: string;
};
export type Group = { companyId: string; key: AppDataKey; rows: Row[]; links: Link[] };
export const conflict = () =>
  new PlanningControllerError(
    'This planning change can no longer be applied.',
    'VALIDATION_ERROR',
    409,
  );
export const invalid = (message: string) =>
  new PlanningControllerError(message, 'VALIDATION_ERROR', 400);

export function rowId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw conflict();
  return value;
}

export function slice(data: AppData, companyId: string): AppData {
  const next = { ...data, accounts: data.accounts.filter((row) => row.id === companyId) };
  for (const key of SCOPED_KEYS) {
    Object.assign(next, { [key]: data[key].filter((row) => row.accountId === companyId) });
  }
  return next;
}

export const rows = (data: AppData, key: AppDataKey): Row[] => data[key] as unknown as Row[];
const put = (data: AppData, key: AppDataKey, next: Row[]): void => {
  Object.assign(data, { [key]: next });
};
export function find(data: AppData, key: AppDataKey, id: string): Row {
  const row = rows(data, key).find((candidate) => candidate.id === id);
  if (!row) throw conflict();
  return row;
}
function normalizeColor(key: AppDataKey, fields: object, current?: Row): object {
  if (
    !('color' in fields) ||
    !['accounts', 'clients', 'projects', 'disciplines', 'resources'].includes(key)
  ) {
    return fields;
  }
  const color = fields.color;
  if (key === 'disciplines' && color === null) return fields;
  if (typeof color !== 'string') {
    throw invalid('A colour must be selected from the available swatches.');
  }
  const kind = 'kind' in fields ? fields.kind : current?.kind;
  if (key === 'accounts' && !isPresetColor(color)) {
    throw invalid('A colour must be selected from the available swatches.');
  }
  return {
    ...fields,
    color:
      key === 'resources' && kind === 'external' && color === NEUTRAL_COLOR
        ? color
        : snapToPresetColor(color),
  };
}
export function insert(
  data: AppData,
  key: AppDataKey,
  id: string,
  fields: object,
  companyId: string,
): void {
  if (rows(data, key).some((row) => row.id === id)) throw conflict();
  const defaults = key === 'accounts' ? NULLABLE_FIELDS.accounts : NULLABLE_FIELDS[key];
  put(data, key, [
    ...rows(data, key),
    {
      ...defaults,
      ...normalizeColor(key, fields),
      id,
      ...(key === 'accounts' ? {} : { accountId: companyId }),
      ...stamp(),
    },
  ]);
}
export function patch(data: AppData, key: AppDataKey, id: string, changes: object): void {
  const current = find(data, key, id);
  const normalized = normalizeColor(key, changes, current);
  put(
    data,
    key,
    rows(data, key).map((row) =>
      row.id === id ? { ...current, ...normalized, updatedAt: touchAfter(current.updatedAt) } : row,
    ),
  );
}
export function deleteRows(
  data: AppData,
  key: AppDataKey,
  ids: string[],
  groups: Map<string, Group>,
): string {
  const selected = ids.map((id) => find(data, key, id));
  const links: Link[] = [];
  if (key === 'disciplines' || key === 'phases') {
    const childKey = key === 'disciplines' ? 'resources' : 'activities';
    const field = key === 'disciplines' ? 'disciplineId' : 'phaseId';
    for (const child of rows(data, childKey)) {
      if (!ids.includes(String(child[field]))) continue;
      links.push({ key: childKey, id: child.id, field, parentId: String(child[field]) });
      patch(data, childKey, child.id, { [field]: null });
    }
  }
  put(
    data,
    key,
    rows(data, key).filter((row) => !ids.includes(row.id)),
  );
  const groupId = newId();
  groups.set(groupId, { companyId: String(selected[0]?.accountId), key, rows: selected, links });
  return groupId;
}
export function restore(data: AppData, group: Group): void {
  if (group.rows.some((row) => rows(data, group.key).some((current) => current.id === row.id))) {
    throw conflict();
  }
  for (const link of group.links) {
    if (find(data, link.key, link.id)[link.field] !== null) throw conflict();
  }
  for (const row of group.rows) {
    try {
      if (group.key === 'allocations') {
        const allocation = row as unknown as Allocation;
        const activity = data.activities.find((item) => item.id === allocation.activityId);
        if (activity) assertScopedRefs(data, group.companyId, 'activities', { ...activity });
        assertAllocationRefs(
          data,
          group.companyId,
          allocation.resourceId,
          allocation.activityId,
          allocation.hoursPerDay,
          allocation.projectId,
        );
        assertDateRange(allocation.startDate, allocation.endDate);
        const resource = data.resources.find((item) => item.id === allocation.resourceId);
        if (!resource) throw conflict();
        const account = data.accounts.find((item) => item.id === group.companyId);
        const accountWorkingDays = normalizeAccountWorkingDays(
          account?.workingDays,
          account?.weekStartsOn === 0 ? 0 : 1,
        );
        assertAllocationPlacement({ allocation, resource, accountWorkingDays });
      }
      if (group.key === 'phases') assertScopedRefs(data, group.companyId, 'phases', row);
      if (group.key === 'timeOff') {
        assertResourceExists(data, group.companyId, String(row.resourceId));
      }
    } catch (error) {
      if (error instanceof DomainError) throw conflict();
      throw error;
    }
  }
  put(data, group.key, [
    ...rows(data, group.key),
    ...group.rows.map((row) => ({ ...row, updatedAt: touchAfter(row.updatedAt) })),
  ]);
  for (const link of group.links) {
    const child = find(data, link.key, link.id);
    try {
      assertScopedRefs(
        data,
        group.companyId,
        link.key,
        { ...child, [link.field]: link.parentId },
        child,
      );
    } catch (error) {
      if (error instanceof DomainError) throw conflict();
      throw error;
    }
    patch(data, link.key, link.id, { [link.field]: link.parentId });
  }
}
export function lifecycle(
  data: AppData,
  key: 'clients' | 'projects' | 'activities' | 'resources',
  id: string,
  action: 'archive' | 'unarchive',
): void {
  const current = find(data, key, id);
  const updated =
    action === 'archive'
      ? archive(current as never, touchAfter(current.updatedAt))
      : unarchive(current as never);
  patch(data, key, id, updated);
}
