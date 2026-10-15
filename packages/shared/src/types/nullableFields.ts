import type { AppData, AppDataKey } from "./entities.js";

type NullableProperties<T> = { [K in keyof T as null extends T[K] ? K : never]: null };

/** Present empty values for every nullable entity property. */
export const NULLABLE_FIELDS = {
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
  allocations: { projectId: null, seriesId: null, note: null, task: null, ignoreWeekends: null },
  timeOff: { note: null },
  closures: {},
} as const satisfies { [K in AppDataKey]: NullableProperties<AppData[K][number]> };

/** Fill omitted legacy or imported nullable properties without changing populated values. */
export function fillNullableFields(key: AppDataKey, record: object): void {
  for (const field of Object.keys(NULLABLE_FIELDS[key])) {
    if (Reflect.get(record, field) === undefined) Object.assign(record, { [field]: null });
  }
}
