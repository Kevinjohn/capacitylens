import { describe, expect, it } from 'vitest';
import { APP_DATA_KEYS } from './entityKeys.js';
import { requiredFields } from './entityFields.js';
import { NULLABLE_FIELDS } from './nullableFields.js';

// The hand-written tables the field table replaced, kept until the next pull request.
const OLD_REQUIRED_FIELDS = {
  accounts: ['name', 'color'],
  disciplines: ['companyId', 'name', 'sortOrder'],
  resources: [
    'companyId',
    'kind',
    'role',
    'employmentType',
    'workingHoursPerDay',
    'workingDays',
    'color',
  ],
  clients: ['companyId', 'name', 'color'],
  projects: ['companyId', 'name', 'color', 'clientId'],
  phases: ['companyId', 'name', 'projectId'],
  activities: ['companyId', 'name', 'kind'],
  allocations: [
    'companyId',
    'resourceId',
    'activityId',
    'startDate',
    'endDate',
    'hoursPerDay',
    'status',
  ],
  timeOff: ['companyId', 'resourceId', 'startDate', 'endDate', 'type'],
  closures: ['companyId', 'name', 'startDate', 'endDate'],
};

const OLD_NULLABLE_FIELDS = {
  accounts: {
    schedulingMode: null,
    timezone: null,
    weekStartsOn: null,
    workingDays: null,
    language: null,
    disciplinesEnabled: null,
    placeholdersEnabled: null,
    externalEnabled: null,
    inlineActivityCreateEnabled: null,
    showTaskFieldInSchedule: null,
    capacityOverviewAccess: null,
    dateStyle: null,
  },
  disciplines: { color: null },
  resources: {
    name: null,
    avatarUrl: null,
    disciplineId: null,
    projectId: null,
    isFavourite: null,
    firstAvailableDate: null,
    lastAvailableDate: null,
    archivedAt: null,
    deletedAt: null,
  },
  clients: { isPrivate: null, codeName: null, builtin: null, archivedAt: null, deletedAt: null },
  projects: { isPrivate: null, codeName: null, archivedAt: null, deletedAt: null },
  phases: {},
  activities: { projectId: null, phaseId: null, archivedAt: null, deletedAt: null },
  allocations: { projectId: null, seriesId: null, note: null, task: null, ignoreWorkingDays: null },
  timeOff: { note: null },
  closures: {},
};

describe('entity field table', () => {
  it.each(APP_DATA_KEYS)('derives the required fields of %s that were hand-written', (table) => {
    // The list order follows the table; the refusal that names them is not reachable with two.
    expect([...requiredFields[table]].sort()).toEqual([...OLD_REQUIRED_FIELDS[table]].sort());
  });

  it.each(APP_DATA_KEYS)('derives the nullable fields of %s that were hand-written', (table) => {
    expect(NULLABLE_FIELDS[table]).toEqual(OLD_NULLABLE_FIELDS[table]);
  });
});
