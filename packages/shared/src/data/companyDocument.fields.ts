import type { AppData, AppDataKey } from '../types/entities.js';

/**
 * A row field as the interchange format names it: rows carry their company as `accountId` in the
 * export, which documents already written must keep reading.
 */
type WireField<T> =
  Exclude<keyof T, 'companyId'> | ('companyId' extends keyof T ? 'accountId' : never);

/** Declares every portable field for each beta export table. */
export const FIELDS = {
  accounts: [
    'id',
    'createdAt',
    'updatedAt',
    'name',
    'color',
    'schedulingMode',
    'timezone',
    'weekStartsOn',
    'workingDays',
    'language',
    'disciplinesEnabled',
    'placeholdersEnabled',
    'externalEnabled',
    'inlineActivityCreateEnabled',
    'showTaskFieldInSchedule',
    'capacityOverviewAccess',
    'dateStyle',
  ],
  disciplines: ['id', 'accountId', 'createdAt', 'updatedAt', 'name', 'color', 'sortOrder'],
  resources: [
    'id',
    'accountId',
    'createdAt',
    'updatedAt',
    'kind',
    'name',
    'role',
    'avatarUrl',
    'disciplineId',
    'employmentType',
    'engagement',
    'workingHoursPerDay',
    'workingDays',
    'halfDays',
    'projectId',
    'color',
    'isFavourite',
    'firstAvailableDate',
    'lastAvailableDate',
    'archivedAt',
    'deletedAt',
  ],
  clients: [
    'id',
    'accountId',
    'createdAt',
    'updatedAt',
    'name',
    'color',
    'isPrivate',
    'codeName',
    'builtin',
    'archivedAt',
    'deletedAt',
  ],
  projects: [
    'id',
    'accountId',
    'createdAt',
    'updatedAt',
    'name',
    'clientId',
    'color',
    'isPrivate',
    'codeName',
    'archivedAt',
    'deletedAt',
  ],
  phases: ['id', 'accountId', 'createdAt', 'updatedAt', 'name', 'projectId'],
  activities: [
    'id',
    'accountId',
    'createdAt',
    'updatedAt',
    'name',
    'kind',
    'projectId',
    'phaseId',
    'archivedAt',
    'deletedAt',
  ],
  allocations: [
    'id',
    'accountId',
    'createdAt',
    'updatedAt',
    'resourceId',
    'activityId',
    'projectId',
    'seriesId',
    'startDate',
    'endDate',
    'hoursPerDay',
    'status',
    'note',
    'task',
    'ignoreWorkingDays',
  ],
  timeOff: [
    'id',
    'accountId',
    'createdAt',
    'updatedAt',
    'resourceId',
    'startDate',
    'endDate',
    'type',
    'note',
  ],
  closures: ['id', 'accountId', 'createdAt', 'updatedAt', 'name', 'startDate', 'endDate'],
} as const satisfies { [K in AppDataKey]: readonly WireField<AppData[K][number]>[] };

/** Read-projection fields the server adds for the reader; they are never exported. */
type ReadProjectionField = 'displayName';

type MissingPortableField = {
  [K in AppDataKey]: Exclude<
    WireField<AppData[K][number]>,
    (typeof FIELDS)[K][number] | ReadProjectionField
  >;
}[AppDataKey];
const portableFieldsAreComplete: MissingPortableField extends never ? true : never = true;
void portableFieldsAreComplete;

/** One untrusted export row, read field by field. */
export type Row = Record<string, unknown>;
