import type { PlanningIntent } from '@/api/planningContracts';
import { allocationAttributionAllowed } from '@capacitylens/shared/lib/integrity';
import {
  externalCapacityDefaults,
  placeholderCapacityDefaults,
} from '@capacitylens/shared/types/entities';
import type {
  Company,
  Activity,
  Allocation,
  AppData,
  AppDataKey,
  Client,
  Closure,
  Discipline,
  Phase,
  Project,
  Resource,
  TimeOff,
} from '@capacitylens/shared/types/entities';
import { NEUTRAL_COLOR } from '@capacitylens/shared/lib/color';
import type { Draft, Patch } from '@/lib/entityDrafts';

export interface PlanningCommand {
  intent: PlanningIntent;
  /** The edited row's `updatedAt` when its form opened; the server refuses a row that has moved on. */
  expectedUpdatedAt?: string;
  /** The change cannot be undone and ends the page's history. */
  endsHistory?: true;
}

interface CommandContext {
  data: AppData;
  companyId: string;
}

interface CreateCommandContext extends CommandContext {
  args: { id: string };
}

interface UpdateCommandContext<Row> extends CommandContext {
  original: Row;
  args: { id: string; changes: object };
}

const equal = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  return false;
};

type OwnedRow<K extends AppDataKey> = K extends 'accounts' ? Company : AppData[K][number];

function getOwnedRow<K extends AppDataKey>(
  data: AppData,
  key: K,
  companyId: string,
  id: string,
): OwnedRow<K> | undefined {
  if (key === 'accounts') {
    return data.accounts.find((row) => row.id === id) as OwnedRow<K> | undefined;
  }
  return data[key].find(
    (row) => 'companyId' in row && row.companyId === companyId && row.id === id,
  ) as OwnedRow<K> | undefined;
}

function hasAccount(data: AppData, companyId: string): boolean {
  return data.accounts.some((account) => account.id === companyId);
}

function diffFields(
  original: object,
  requested: object,
  fields: readonly string[],
  nullable: readonly string[] = [],
): { changes: Record<string, unknown> } | null {
  const changes: Record<string, unknown> = {};
  for (const field of fields) {
    if (!Object.hasOwn(requested, field)) continue;
    const rawValue = Reflect.get(requested, field) as unknown;
    const value = rawValue === undefined && nullable.includes(field) ? null : rawValue;
    const originalValue = Reflect.get(original, field) as unknown;
    if (equal(originalValue, value)) continue;
    changes[field] = value;
  }
  return Object.keys(changes).length === 0 ? null : { changes };
}

/** Build an explicit allocation creation intent. */
export function buildAllocationCreate(
  context: CreateCommandContext & { args: { id: string; fields: Draft<Allocation> } },
): PlanningCommand | null {
  const { data, companyId, args } = context;
  if (!hasAccount(data, companyId)) return null;
  const activity = data.activities.find(
    (row) => row.companyId === companyId && row.id === args.fields.activityId,
  );
  if (!activity) return null;
  const allocation = {
    id: args.id,
    resourceId: args.fields.resourceId,
    activityId: args.fields.activityId,
    projectId: allocationAttributionAllowed(activity.kind) ? (args.fields.projectId ?? null) : null,
    startDate: args.fields.startDate,
    endDate: args.fields.endDate,
    hoursPerDay: args.fields.hoursPerDay,
    status: args.fields.status,
    note: args.fields.note ?? null,
    task: args.fields.task ?? null,
    ignoreWorkingDays: args.fields.ignoreWorkingDays ?? null,
  };
  return {
    intent: { operation: 'allocation.create', allocation },
  };
}

/** Use source duplication for unchanged copies, retaining deliberate edits through explicit creation. */
export function buildAllocationDuplicate(
  context: CommandContext & {
    original: Allocation;
    args: { sourceId: string; id: string; fields: Draft<Allocation> };
  },
): PlanningCommand | null {
  const { data, companyId, original, args } = context;
  if (
    original.id !== args.sourceId ||
    original.companyId !== companyId ||
    !getOwnedRow(data, 'allocations', companyId, args.sourceId)
  ) {
    return null;
  }
  const command = buildAllocationCreate({ data, companyId, args });
  if (!command || command.intent.operation !== 'allocation.create') return null;
  const created = command.intent.allocation;
  const copyFields = [
    'resourceId',
    'activityId',
    'projectId',
    'hoursPerDay',
    'status',
    'note',
    'task',
  ] as const;
  const sameSource =
    copyFields.every((field) => equal(created[field] ?? null, original[field] ?? null)) &&
    Boolean(created.ignoreWorkingDays) === Boolean(original.ignoreWorkingDays);
  if (!sameSource) return command;
  return {
    ...command,
    intent: {
      operation: 'allocation.duplicate',
      sourceAllocationId: args.sourceId,
      occurrence: { id: args.id, startDate: args.fields.startDate, endDate: args.fields.endDate },
    },
  };
}

const ALLOCATION_FIELDS = [
  'resourceId',
  'activityId',
  'projectId',
  'startDate',
  'endDate',
  'hoursPerDay',
  'status',
  'note',
  'task',
  'ignoreWorkingDays',
] as const satisfies readonly (keyof Allocation)[];

/** Build an allocation patch against the captured draft basis. */
export function buildAllocationUpdate(
  context: UpdateCommandContext<Allocation> & { args: { id: string; changes: Patch<Allocation> } },
): PlanningCommand | null {
  const { data, companyId, original, args } = context;
  const current = getOwnedRow(data, 'allocations', companyId, args.id);
  if (!current || original.id !== args.id || original.companyId !== companyId) return null;
  const diff = diffFields(original, args.changes, ALLOCATION_FIELDS, [
    'projectId',
    'note',
    'task',
    'ignoreWorkingDays',
  ]);
  if (!diff) return null;
  const changes = { ...diff.changes };
  const activityId = changes.activityId ?? current.activityId;
  if (Object.hasOwn(changes, 'activityId') || Object.hasOwn(changes, 'projectId')) {
    const activity = data.activities.find(
      (row) => row.companyId === companyId && row.id === activityId,
    );
    if (!activity) return null;
    if (
      !allocationAttributionAllowed(activity.kind) &&
      (changes.projectId ?? current.projectId) !== null
    ) {
      changes.projectId = null;
    }
  }
  return {
    intent: {
      operation: 'allocation.update',
      id: args.id,
      changes,
    },
  };
}

/** Build an explicit time-off creation intent. */
export function buildTimeOffCreate(
  context: CreateCommandContext & { args: { id: string; fields: Draft<TimeOff> } },
): PlanningCommand | null {
  const { data, companyId, args } = context;
  if (
    !hasAccount(data, companyId) ||
    !data.resources.some(
      (resource) => resource.companyId === companyId && resource.id === args.fields.resourceId,
    )
  ) {
    return null;
  }
  const timeOff = {
    id: args.id,
    resourceId: args.fields.resourceId,
    startDate: args.fields.startDate,
    endDate: args.fields.endDate,
    type: args.fields.type,
    ...(Object.hasOwn(args.fields, 'note') ? { note: args.fields.note ?? null } : {}),
  };
  return {
    intent: { operation: 'timeOff.create', timeOff },
  };
}

const TIME_OFF_FIELDS = [
  'resourceId',
  'startDate',
  'endDate',
  'type',
  'note',
] as const satisfies readonly (keyof TimeOff)[];

/** Build a time-off patch against the captured draft basis. */
export function buildTimeOffUpdate(
  context: UpdateCommandContext<TimeOff> & { args: { id: string; changes: Patch<TimeOff> } },
): PlanningCommand | null {
  const { data, companyId, original, args } = context;
  const current = getOwnedRow(data, 'timeOff', companyId, args.id);
  if (!current || original.id !== args.id || original.companyId !== companyId) return null;
  const diff = diffFields(original, args.changes, TIME_OFF_FIELDS, ['note']);
  if (!diff) return null;
  return {
    intent: {
      operation: 'timeOff.update',
      id: args.id,
      changes: diff.changes,
    },
  };
}

/** Build an explicit company-closure creation intent. */
export function buildClosureCreate(
  context: CreateCommandContext & { args: { fields: Draft<Closure> } },
): PlanningCommand | null {
  const { data, companyId, args } = context;
  if (!hasAccount(data, companyId)) return null;
  return {
    intent: {
      operation: 'closure.create',
      id: args.id,
      fields: {
        name: args.fields.name,
        startDate: args.fields.startDate,
        endDate: args.fields.endDate,
      },
    },
  };
}

const CLOSURE_FIELDS = [
  'name',
  'startDate',
  'endDate',
] as const satisfies readonly (keyof Closure)[];

/** Build a company-closure patch against the captured draft basis. */
export function buildClosureUpdate(
  context: UpdateCommandContext<Closure> & { args: { id: string; changes: Patch<Closure> } },
): PlanningCommand | null {
  const { data, companyId, original, args } = context;
  const current = getOwnedRow(data, 'closures', companyId, args.id);
  if (!current || original.id !== args.id || original.companyId !== companyId) return null;
  const diff = diffFields(original, args.changes, CLOSURE_FIELDS);
  if (!diff) return null;
  return {
    intent: {
      operation: 'closure.update',
      id: args.id,
      changes: diff.changes,
    },
  };
}

/** Build an explicit resource creation intent with normalized kind-specific fields. */
export function buildResourceCreate(
  context: CreateCommandContext & { args: { id: string; fields: Draft<Resource> } },
): PlanningCommand | null {
  const { data, companyId, args } = context;
  if (!hasAccount(data, companyId)) return null;
  const input = args.fields;
  const kindDefaults =
    input.kind === 'external' ? externalCapacityDefaults() : placeholderCapacityDefaults();
  const externalDefaults = externalCapacityDefaults();
  const fields = {
    kind: input.kind,
    name: input.name ?? null,
    role: input.role,
    avatarUrl: input.avatarUrl ?? null,
    disciplineId: input.disciplineId ?? null,
    employmentType:
      input.kind === 'external' ? externalDefaults.employmentType : input.employmentType,
    engagement: input.kind === 'external' ? 'studio' : (input.engagement ?? 'studio'),
    workingHoursPerDay:
      input.kind === 'external' ? externalDefaults.workingHoursPerDay : input.workingHoursPerDay,
    workingDays: input.kind === 'external' ? kindDefaults.workingDays : input.workingDays,
    halfDays: input.kind === 'external' ? kindDefaults.halfDays : input.halfDays,
    projectId: input.kind === 'external' ? null : (input.projectId ?? null),
    color: input.kind === 'external' ? NEUTRAL_COLOR : input.color,
    isFavourite: input.isFavourite ?? null,
    firstAvailableDate: input.kind === 'person' ? (input.firstAvailableDate ?? null) : null,
    lastAvailableDate: input.kind === 'person' ? (input.lastAvailableDate ?? null) : null,
  };
  return {
    intent: { operation: 'resource.create', id: args.id, fields },
  };
}

const RESOURCE_FIELDS = [
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
] as const satisfies readonly (keyof Resource)[];

/** Build a resource patch with kind changes normalized to valid resource fields. */
export function buildResourceUpdate(
  context: UpdateCommandContext<Resource> & { args: { id: string; changes: Patch<Resource> } },
): PlanningCommand | null {
  const { data, companyId, original, args } = context;
  const current = getOwnedRow(data, 'resources', companyId, args.id);
  if (!current || original.id !== args.id || original.companyId !== companyId) return null;
  const normalized: Patch<Resource> = { ...args.changes };
  if (args.changes.kind === 'external') {
    Object.assign(normalized, externalCapacityDefaults(), {
      color: NEUTRAL_COLOR,
      projectId: null,
    });
  } else if (args.changes.kind === 'placeholder') {
    Object.assign(normalized, placeholderCapacityDefaults(), { engagement: 'studio' });
  } else if (args.changes.kind === 'person') {
    normalized.projectId = null;
  }
  if (args.changes.kind !== undefined && args.changes.kind !== 'person') {
    normalized.firstAvailableDate = null;
    normalized.lastAvailableDate = null;
  }
  const diff = diffFields(original, normalized, RESOURCE_FIELDS, [
    'name',
    'avatarUrl',
    'disciplineId',
    'projectId',
    'isFavourite',
    'firstAvailableDate',
    'lastAvailableDate',
  ]);
  if (!diff) return null;
  return {
    intent: {
      operation: 'resource.update',
      id: args.id,
      changes: diff.changes,
    },
  };
}

type CatalogueEntity = 'clients' | 'projects' | 'phases' | 'activities' | 'disciplines';
type CatalogueCreateFields =
  | {
      entity: 'clients';
      fields: Pick<Client, 'name' | 'color'> & Partial<Pick<Client, 'isPrivate' | 'codeName'>>;
    }
  | {
      entity: 'projects';
      fields: Pick<Project, 'name' | 'color' | 'clientId'> &
        Partial<Pick<Project, 'isPrivate' | 'codeName'>>;
    }
  | { entity: 'phases'; fields: Pick<Phase, 'name' | 'projectId'> }
  | {
      entity: 'activities';
      fields: Pick<Activity, 'name' | 'kind'> & Partial<Pick<Activity, 'projectId' | 'phaseId'>>;
    }
  | {
      entity: 'disciplines';
      fields: Pick<Discipline, 'name' | 'sortOrder'> & Partial<Pick<Discipline, 'color'>>;
    };

/** Build an explicit catalogue creation intent, preserving supplied links for validation. */
export function buildCatalogueCreate(
  context: CreateCommandContext & { args: { id: string } & CatalogueCreateFields },
): PlanningCommand | null {
  const { data, companyId, args } = context;
  if (!hasAccount(data, companyId)) return null;
  let entity: Extract<PlanningIntent, { operation: 'catalogue.create' }>['entity'];
  switch (args.entity) {
    case 'clients':
      entity = {
        entity: 'clients',
        id: args.id,
        fields: {
          name: args.fields.name,
          color: args.fields.color,
          isPrivate: args.fields.isPrivate ?? null,
          codeName: args.fields.codeName ?? null,
        },
      };
      break;
    case 'projects':
      entity = {
        entity: 'projects',
        id: args.id,
        fields: {
          ...args.fields,
          isPrivate: args.fields.isPrivate ?? null,
          codeName: args.fields.codeName ?? null,
        },
      };
      break;
    case 'phases':
      entity = { entity: 'phases', id: args.id, fields: args.fields };
      break;
    case 'activities': {
      entity = {
        entity: 'activities',
        id: args.id,
        fields: {
          name: args.fields.name,
          kind: args.fields.kind,
          projectId: args.fields.projectId ?? null,
          phaseId: args.fields.phaseId ?? null,
        },
      };
      break;
    }
    case 'disciplines':
      entity = {
        entity: 'disciplines',
        id: args.id,
        fields: { ...args.fields, color: args.fields.color ?? null },
      };
      break;
  }
  return {
    intent: { operation: 'catalogue.create', entity },
  };
}

type CatalogueRow = Client | Project | Phase | Activity | Discipline;
type CatalogueChanges =
  | { entity: 'clients'; id: string; changes: Patch<Client> }
  | { entity: 'projects'; id: string; changes: Patch<Project> }
  | { entity: 'phases'; id: string; changes: Patch<Phase> }
  | { entity: 'activities'; id: string; changes: Patch<Activity> }
  | { entity: 'disciplines'; id: string; changes: Patch<Discipline> };

const CATALOGUE_FIELDS: Record<CatalogueEntity, readonly string[]> = {
  clients: ['name', 'color', 'isPrivate', 'codeName'],
  projects: ['name', 'color', 'clientId', 'isPrivate', 'codeName'],
  phases: ['name', 'projectId'],
  activities: ['name', 'kind', 'projectId', 'phaseId'],
  disciplines: ['name', 'color', 'sortOrder'],
};

/** Build a catalogue patch against its captured draft basis. */
export function buildCatalogueUpdate(
  context: CommandContext & { original: CatalogueRow; args: CatalogueChanges },
): PlanningCommand | null {
  const { data, companyId, original, args } = context;
  const key = args.entity;
  const current = getOwnedRow(data, key, companyId, args.id);
  if (!current || original.id !== args.id || original.companyId !== companyId) return null;
  const requested = { ...args.changes };
  if (key === 'activities') {
    const requestedKind = args.changes.kind;
    const currentActivity = data.activities.find(
      (row) => row.companyId === companyId && row.id === args.id,
    );
    if (!currentActivity) return null;
    const effectiveKind = requestedKind ?? currentActivity.kind;
    if (effectiveKind !== 'project') {
      Object.assign(requested, { projectId: null, phaseId: null });
    }
  }
  const nullableFields: readonly string[] =
    key === 'clients' || key === 'projects'
      ? ['isPrivate', 'codeName']
      : key === 'activities'
        ? ['projectId', 'phaseId']
        : key === 'disciplines'
          ? ['color']
          : [];
  const diff = diffFields(original, requested, CATALOGUE_FIELDS[key], nullableFields);
  if (!diff) return null;
  if (
    (key === 'clients' || key === 'projects') &&
    Object.hasOwn(args.changes, 'isPrivate') &&
    isPublic(Reflect.get(original, 'isPrivate')) &&
    isPublic(Reflect.get(args.changes, 'isPrivate'))
  ) {
    delete diff.changes.isPrivate;
    if (Object.keys(diff.changes).length === 0) return null;
  }
  const entity = { entity: key, id: args.id, changes: diff.changes };
  return {
    intent: { operation: 'catalogue.update', entity },
  };
}

function isPublic(value: unknown): boolean {
  return value === null || value === false || value === undefined;
}

type SettingsFields = Pick<
  Company,
  | 'name'
  | 'color'
  | 'weekStartsOn'
  | 'timezone'
  | 'schedulingMode'
  | 'workingDays'
  | 'disciplinesEnabled'
  | 'placeholdersEnabled'
  | 'externalEnabled'
  | 'inlineActivityCreateEnabled'
  | 'showTaskFieldInSchedule'
  | 'capacityOverviewAccess'
  | 'dateStyle'
>;

/** Build a field-limited account settings patch. */
export function buildSettingsUpdate(
  context: CommandContext & { original: Company; args: Pick<Patch<Company>, keyof SettingsFields> },
): PlanningCommand | null {
  const { data, companyId, original, args } = context;
  const current = data.accounts.find((account) => account.id === companyId);
  if (!current || original.id !== companyId) return null;
  const allowedFields = [
    'name',
    'color',
    'weekStartsOn',
    'timezone',
    'schedulingMode',
    'workingDays',
    'disciplinesEnabled',
    'placeholdersEnabled',
    'externalEnabled',
    'inlineActivityCreateEnabled',
    'showTaskFieldInSchedule',
    'capacityOverviewAccess',
    'dateStyle',
  ] as const satisfies readonly (keyof SettingsFields)[];
  const fields = allowedFields.filter((field) => Object.hasOwn(args, field));
  const diff = diffFields(original, args, fields, [
    'weekStartsOn',
    'timezone',
    'schedulingMode',
    'workingDays',
    'disciplinesEnabled',
    'placeholdersEnabled',
    'externalEnabled',
    'inlineActivityCreateEnabled',
    'showTaskFieldInSchedule',
    'capacityOverviewAccess',
    'dateStyle',
  ]);
  if (!diff) return null;
  return {
    intent: { operation: 'settings.update', changes: diff.changes },
  };
}
