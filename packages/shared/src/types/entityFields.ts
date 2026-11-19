import type { AppData } from './entityTypes.js';
import {
  ACTIVITY_KINDS,
  ALLOCATION_STATUSES,
  CAPACITY_OVERVIEW_ACCESS_VALUES,
  DATE_STYLES,
  EMPLOYMENT_TYPES,
  RESOURCE_ENGAGEMENTS,
  RESOURCE_KINDS,
  SCHEDULING_MODES,
  TIME_OFF_TYPES,
} from './entityTypes.js';
import { APP_DATA_KEYS } from './entityKeys.js';
import type { AppDataKey } from './entityKeys.js';

/** The value rule a stored field follows. */
export type FieldKind =
  | 'identifier'
  | 'text'
  | 'note'
  | 'boolean'
  | 'number'
  | 'date'
  | 'weekdays'
  | 'color'
  | 'avatar'
  | 'timezone'
  | 'weekStart'
  | 'choice';

/** One stored field of an entity: its rule, and whether it is required, nullable or server-owned. */
export interface FieldSpec {
  kind: FieldKind;
  /** A complete row must carry the field. */
  required?: true;
  /** The field accepts `null`. */
  nullable?: true;
  /** The accepted values of a `choice` field. */
  choices?: readonly (string | number)[];
  /** Set by the server, never by a planning change. */
  system?: true;
}

const base = {
  id: { kind: 'identifier', system: true },
  createdAt: { kind: 'identifier', system: true },
  updatedAt: { kind: 'identifier', system: true },
} as const;
const scoped = {
  ...base,
  companyId: { kind: 'identifier', required: true, system: true },
} as const;
const lifecycle = {
  archivedAt: { kind: 'identifier', nullable: true, system: true },
  deletedAt: { kind: 'identifier', nullable: true, system: true },
} as const;
const privateName = {
  isPrivate: { kind: 'boolean', nullable: true },
  codeName: { kind: 'text', nullable: true },
} as const;
const dates = {
  startDate: { kind: 'date', required: true },
  endDate: { kind: 'date', required: true },
} as const;

/**
 * Every stored field of every entity. The `satisfies` clause makes the table and the entity
 * interfaces agree: a field in one and not the other fails to compile. `displayName` is a
 * read-projection field and is never stored.
 */
export const ENTITY_FIELDS = {
  accounts: {
    ...base,
    name: { kind: 'text', required: true },
    color: { kind: 'color', required: true },
    schedulingMode: { kind: 'choice', nullable: true, choices: SCHEDULING_MODES },
    timezone: { kind: 'timezone', nullable: true },
    weekStartsOn: { kind: 'weekStart', nullable: true },
    workingDays: { kind: 'weekdays', nullable: true },
    language: { kind: 'choice', nullable: true, choices: ['en'] },
    disciplinesEnabled: { kind: 'boolean', nullable: true },
    placeholdersEnabled: { kind: 'boolean', nullable: true },
    externalEnabled: { kind: 'boolean', nullable: true },
    inlineActivityCreateEnabled: { kind: 'boolean', nullable: true },
    showTaskFieldInSchedule: { kind: 'boolean', nullable: true },
    capacityOverviewAccess: {
      kind: 'choice',
      nullable: true,
      choices: CAPACITY_OVERVIEW_ACCESS_VALUES,
    },
    dateStyle: { kind: 'choice', nullable: true, choices: DATE_STYLES },
  },
  disciplines: {
    ...scoped,
    name: { kind: 'text', required: true },
    color: { kind: 'color', nullable: true },
    sortOrder: { kind: 'number', required: true },
  },
  resources: {
    ...scoped,
    ...lifecycle,
    kind: { kind: 'choice', required: true, choices: RESOURCE_KINDS },
    name: { kind: 'text', nullable: true },
    role: { kind: 'text', required: true },
    avatarUrl: { kind: 'avatar', nullable: true },
    disciplineId: { kind: 'identifier', nullable: true },
    employmentType: { kind: 'choice', required: true, choices: EMPLOYMENT_TYPES },
    engagement: { kind: 'choice', choices: RESOURCE_ENGAGEMENTS },
    workingHoursPerDay: { kind: 'number', required: true },
    workingDays: { kind: 'weekdays', required: true },
    halfDays: { kind: 'weekdays' },
    projectId: { kind: 'identifier', nullable: true },
    color: { kind: 'color', required: true },
    isFavourite: { kind: 'boolean', nullable: true },
    firstAvailableDate: { kind: 'date', nullable: true },
    lastAvailableDate: { kind: 'date', nullable: true },
  },
  clients: {
    ...scoped,
    ...lifecycle,
    ...privateName,
    name: { kind: 'text', required: true },
    color: { kind: 'color', required: true },
    builtin: { kind: 'boolean', nullable: true },
  },
  projects: {
    ...scoped,
    ...lifecycle,
    ...privateName,
    name: { kind: 'text', required: true },
    clientId: { kind: 'identifier', required: true },
    color: { kind: 'color', required: true },
  },
  phases: {
    ...scoped,
    name: { kind: 'text', required: true },
    projectId: { kind: 'identifier', required: true },
  },
  activities: {
    ...scoped,
    ...lifecycle,
    name: { kind: 'text', required: true },
    kind: { kind: 'choice', required: true, choices: ACTIVITY_KINDS },
    projectId: { kind: 'identifier', nullable: true },
    phaseId: { kind: 'identifier', nullable: true },
  },
  allocations: {
    ...scoped,
    ...dates,
    resourceId: { kind: 'identifier', required: true },
    activityId: { kind: 'identifier', required: true },
    projectId: { kind: 'identifier', nullable: true },
    hoursPerDay: { kind: 'number', required: true },
    status: { kind: 'choice', required: true, choices: ALLOCATION_STATUSES },
    note: { kind: 'note', nullable: true },
    task: { kind: 'text', nullable: true },
    ignoreWorkingDays: { kind: 'boolean', nullable: true },
    seriesId: { kind: 'identifier', nullable: true, system: true },
  },
  timeOff: {
    ...scoped,
    ...dates,
    resourceId: { kind: 'identifier', required: true },
    type: { kind: 'choice', required: true, choices: TIME_OFF_TYPES },
    note: { kind: 'note', nullable: true },
  },
  closures: { ...scoped, ...dates, name: { kind: 'text', required: true } },
} as const satisfies {
  [K in AppDataKey]: Record<Exclude<keyof AppData[K][number], 'displayName'>, FieldSpec>;
};

type Fields<K extends AppDataKey> = (typeof ENTITY_FIELDS)[K];

// Spread entries escape the excess-property check, so check the reverse direction explicitly.
type UndeclaredField = {
  [K in AppDataKey]: Exclude<keyof Fields<K>, keyof AppData[K][number]>;
}[AppDataKey];
const tableFieldsAreDeclared: UndeclaredField extends never ? true : never = true;
void tableFieldsAreDeclared;

/** The fields of an entity a planning change may write: every field that is not `system`. */
export type WritableField<K extends AppDataKey> = {
  [F in keyof Fields<K>]: Fields<K>[F] extends { system: true } ? never : F;
}[keyof Fields<K>];

/** The present empty value of every nullable field of an entity. */
export type NullableFieldValues<K extends AppDataKey> = {
  [F in keyof Fields<K> as Fields<K>[F] extends { nullable: true } ? F : never]: null;
};

function fieldsWhere<K extends AppDataKey>(table: K, test: (spec: FieldSpec) => boolean) {
  const specs: Record<string, FieldSpec> = ENTITY_FIELDS[table];
  return Object.entries(specs)
    .filter(([, spec]) => test(spec))
    .map(([field]) => field);
}

function buildRequiredFields() {
  const required: Partial<Record<AppDataKey, readonly string[]>> = {};
  for (const table of APP_DATA_KEYS) {
    required[table] = fieldsWhere(table, (spec) => spec.required === true);
  }
  // The loop above fills every key of APP_DATA_KEYS.
  return required as Record<AppDataKey, readonly string[]>;
}

/** The fields a complete row of each entity must carry. */
export const requiredFields = buildRequiredFields();

/** The fields of an entity a planning change may write. */
export function writableFields<K extends AppDataKey>(table: K): readonly WritableField<K>[] {
  // The filter keeps exactly the keys the mapped type keeps.
  return fieldsWhere(table, (spec) => spec.system !== true) as WritableField<K>[];
}

/** The present empty value of every nullable field, for every entity. */
export function buildNullableFields(): { [K in AppDataKey]: NullableFieldValues<K> } {
  // The filter keeps exactly the keys the mapped type keeps.
  return Object.fromEntries(
    APP_DATA_KEYS.map((table) => [
      table,
      Object.fromEntries(
        fieldsWhere(table, (spec) => spec.nullable === true).map((field) => [field, null]),
      ),
    ]),
  ) as { [K in AppDataKey]: NullableFieldValues<K> };
}
