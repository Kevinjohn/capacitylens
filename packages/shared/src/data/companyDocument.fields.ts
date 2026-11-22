import type { AppData, AppDataKey } from '../types/entities.js';

/** Declares every portable field for each beta export table. */
export const FIELDS = {
  companies: [
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
  disciplines: ['id', 'companyId', 'createdAt', 'updatedAt', 'name', 'color', 'sortOrder'],
  resources: [
    'id',
    'companyId',
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
    'companyId',
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
    'companyId',
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
  phases: ['id', 'companyId', 'createdAt', 'updatedAt', 'name', 'projectId'],
  activities: [
    'id',
    'companyId',
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
    'companyId',
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
    'companyId',
    'createdAt',
    'updatedAt',
    'resourceId',
    'startDate',
    'endDate',
    'type',
    'note',
  ],
  closures: ['id', 'companyId', 'createdAt', 'updatedAt', 'name', 'startDate', 'endDate'],
} as const satisfies { [K in AppDataKey]: readonly (keyof AppData[K][number])[] };

/** Read-projection fields the server adds for the reader; they are never exported. */
type ReadProjectionField = 'displayName';

type MissingPortableField = {
  [K in AppDataKey]: Exclude<
    keyof AppData[K][number],
    (typeof FIELDS)[K][number] | ReadProjectionField
  >;
}[AppDataKey];
const portableFieldsAreComplete: MissingPortableField extends never ? true : never = true;
void portableFieldsAreComplete;

/** One untrusted export row, read field by field. */
export type Row = Record<string, unknown>;
