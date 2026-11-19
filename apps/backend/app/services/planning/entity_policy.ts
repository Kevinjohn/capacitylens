import { errors } from '@vinejs/vine';
import {
  RESOURCE_KINDS,
  buildExternalCapacityDefaults,
  type Company,
  type AppData,
  type ScopedEntityKey,
} from '@capacitylens/shared/types/entities';
import { NEUTRAL_COLOR } from '@capacitylens/shared/lib/color';
import {
  parseFixedWorkingPattern,
  areHalfDaysWithinWorkingDays,
  isSameWeekdays,
} from '@capacitylens/shared/domain/resourceWorkingPattern';
import type { ValidationDataLookup } from '@capacitylens/shared/domain/mutations';
import { cleanText } from '@capacitylens/shared/lib/strings';
import { hasUsablePrivateCodeName } from '@capacitylens/shared/domain/privateNames';
import { DomainError } from '@capacitylens/shared/domain/errors';
import { parseResourceAvatarUrl } from '@capacitylens/shared/domain/resourceAvatarUrl';
import { fillNullableFields } from '@capacitylens/shared/types/nullableFields';
import { isLifecycleEntityKey } from '@capacitylens/shared/domain/lifecycle';
import { requiredFields } from '@capacitylens/shared/types/entityFields';
import { validateRow } from '#validators/planning/row';
import { asRecord } from '#services/planning/writer';
import { ENTITY_ID_PATTERN } from '#validators/planning/fields';
import { assertEntityDomain, type EntityWrite } from '#services/planning/entity_validation/domain';
import { normalizeValidWrite } from '#services/planning/entity_validation/normalization';
import {
  listHiddenFields,
  restrictionFor,
  isPrivateRowRestricted,
} from '#services/planning/restricted_fields';
import { EntityWriteError, PlanningOperationError } from '#services/planning/errors';
import { createServerRevision } from '#services/planning/server_timestamp';
import type { PlanningCapabilities } from '#services/planning/data_policy';

// Widened so a stored value of unknown type can be checked against the known kinds.
const resourceKinds: readonly unknown[] = RESOURCE_KINDS;

/** Server-owned values every new row of a table starts with, before validation. */
const CREATE_DEFAULTS: Partial<Record<ScopedEntityKey, Record<string, unknown>>> = {
  clients: { builtin: null },
  allocations: { seriesId: null },
  resources: { avatarUrl: null, halfDays: [], engagement: 'studio' },
};
/** Fields a new row may not supply: lifecycle state and the Internal client flag. */
const SERVER_SET_ON_CREATE = new Set(['archivedAt', 'deletedAt', 'builtin']);

/** Applies a new row's server-owned defaults; lifecycle tables start active. */
export function applyCreateDefaults(table: ScopedEntityKey, candidate: Record<string, unknown>) {
  const defaults: Record<string, unknown> = {
    ...(isLifecycleEntityKey(table) ? { archivedAt: null, deletedAt: null } : {}),
    ...CREATE_DEFAULTS[table],
  };
  for (const [field, value] of Object.entries(defaults)) {
    if (SERVER_SET_ON_CREATE.has(field)) candidate[field] = value;
    else candidate[field] ??= Array.isArray(value) ? [...value] : value;
  }
}

const isEmptyValue = (value: unknown) => value === undefined || value === null || value === false;

/** Refuses a write that names a restricted field the caller may not change. */
export function assertMayWriteRestrictedFields(
  table: ScopedEntityKey,
  fields: Record<string, unknown>,
  capabilities: PlanningCapabilities,
  mode: 'create' | 'update'
) {
  const rule = restrictionFor(table, capabilities);
  if (!rule) return;
  const named = rule.fields.some(
    (field) =>
      Object.hasOwn(fields, field) &&
      !(mode === 'create' && rule.emptyAllowedOnCreate && isEmptyValue(fields[field]))
  );
  if (named) throw new PlanningOperationError(403, 'AUTHORIZATION_DENIED', rule.refusal);
}

const IMMUTABLE_COMPANY_FIELDS = ['language', 'weekStartsOn', 'timezone'] as const;

function reject(field: string, reason: string): never {
  throw new EntityWriteError(`${field} ${reason}.`);
}

/** Keeps a restricted caller's write from changing what it cannot see: stored values win. */
function pinHiddenFields(
  table: ScopedEntityKey,
  candidate: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  context: PlanningCapabilities
) {
  const rule = restrictionFor(table, context);
  if (!rule) return;
  const privateRow = existing?.isPrivate === true;
  const keepsStored = rule.privateRowFields.length === 0 || privateRow;
  for (const field of rule.fields) {
    const stored = existing?.[field];
    if (keepsStored && stored !== null && stored !== undefined) candidate[field] = stored;
    else delete candidate[field];
  }
  if (privateRow) {
    for (const field of rule.privateRowFields) candidate[field] = existing[field];
  }
}

function assertResourceFields(
  requested: Record<string, unknown>,
  candidate: Record<string, unknown>
) {
  const kind = candidate.kind;
  if (
    kind !== 'placeholder' &&
    (typeof candidate.name !== 'string' || cleanText(candidate.name).length === 0)
  ) {
    throw new EntityWriteError('A person or external company name is required.');
  }
  if (kind === 'person') {
    if (requested.projectId !== undefined && requested.projectId !== null) {
      reject('projectId', 'is only used by placeholders');
    }
    const first = candidate.firstAvailableDate;
    const last = candidate.lastAvailableDate;
    if (typeof first === 'string' && typeof last === 'string' && first > last) {
      reject('firstAvailableDate', 'cannot be after lastAvailableDate');
    }
    const days = candidate.workingDays;
    const halves = candidate.halfDays;
    if (
      Array.isArray(days) &&
      Array.isArray(halves) &&
      !areHalfDaysWithinWorkingDays(days, halves)
    ) {
      reject('halfDays', 'must be included in workingDays');
    }
    return;
  }
  if (kind !== 'placeholder' && kind !== 'external') return;
  const pattern = parseFixedWorkingPattern(kind);
  for (const field of ['workingDays', 'halfDays'] as const) {
    if (
      pattern &&
      Object.hasOwn(requested, field) &&
      !isSameWeekdays(candidate[field], pattern[field])
    ) {
      reject(field, "must match this resource kind's defaults");
    }
  }
  if (kind === 'placeholder') {
    if (Object.hasOwn(requested, 'engagement') && candidate.engagement !== 'studio') {
      reject('engagement', 'must be studio for a placeholder');
    }
  } else {
    const externalDefaults = buildExternalCapacityDefaults();
    for (const field of ['employmentType', 'engagement', 'workingHoursPerDay'] as const) {
      if (Object.hasOwn(requested, field) && candidate[field] !== externalDefaults[field]) {
        reject(field, "must match an external resource's defaults");
      }
    }
    if (Object.hasOwn(requested, 'color') && candidate.color !== NEUTRAL_COLOR) {
      reject('color', 'must be the external resource colour');
    }
    for (const field of ['disciplineId', 'projectId'] as const) {
      if (requested[field] != null) {
        reject(field, 'is not used by external resources');
      }
    }
  }
  for (const field of ['firstAvailableDate', 'lastAvailableDate'] as const) {
    if (requested[field] !== undefined && requested[field] !== null) {
      reject(field, 'is only used by people');
    }
  }
  if (Object.hasOwn(requested, 'avatarUrl')) {
    if (requested.avatarUrl !== null && requested.avatarUrl !== undefined) {
      throw new EntityWriteError(
        'Only a person can have an avatar URL.',
        400,
        undefined,
        'resource_avatar_url_forbidden'
      );
    }
  }
}

function assertResourceKind(candidate: Record<string, unknown>, existing: Record<string, unknown>) {
  if (!resourceKinds.includes(existing.kind)) {
    throw new EntityWriteError(
      'The stored resource kind is invalid and must be repaired by import.',
      400,
      undefined,
      'resource_kind_immutable'
    );
  }
  if (candidate.kind !== existing.kind) {
    throw new EntityWriteError(
      'A resource’s kind cannot change after creation.',
      400,
      undefined,
      'resource_kind_immutable'
    );
  }
}

function assertManagedFields(
  table: ScopedEntityKey,
  requested: Record<string, unknown>,
  candidate: Record<string, unknown>,
  existing: Record<string, unknown> | undefined
) {
  if (isLifecycleEntityKey(table)) {
    for (const field of ['archivedAt', 'deletedAt'] as const) {
      if (Object.hasOwn(requested, field) && requested[field] !== (existing?.[field] ?? null)) {
        throw new EntityWriteError(`${field} is managed by its lifecycle action.`);
      }
      candidate[field] = existing?.[field] ?? null;
    }
  }
  if (table === 'allocations' && existing) {
    if (Object.hasOwn(requested, 'seriesId') && requested.seriesId !== existing.seriesId) {
      throw new EntityWriteError('seriesId is fixed after creation.');
    }
    candidate.seriesId = existing.seriesId ?? null;
  }
  if (table === 'resources' && existing && candidate.kind === 'person') {
    for (const field of ['firstAvailableDate', 'lastAvailableDate'] as const) {
      if (!Object.hasOwn(requested, field) && typeof existing[field] === 'string') {
        candidate[field] = existing[field];
      }
    }
  }
}

/** Keep typed settings and entity writes on one frozen-field policy. */
export function assertFrozenCompanyFields(
  requested: Record<string, unknown>,
  candidate: Record<string, unknown>,
  existing: Partial<Pick<Company, (typeof IMMUTABLE_COMPANY_FIELDS)[number]>>
) {
  for (const field of IMMUTABLE_COMPANY_FIELDS) {
    if (
      Object.hasOwn(requested, field) &&
      existing[field] !== undefined &&
      existing[field] !== null &&
      requested[field] !== existing[field]
    ) {
      throw new EntityWriteError(
        'Language, week start and time zone are set when the company is created and cannot be changed.',
        409
      );
    }
    if (!Object.hasOwn(requested, field) && existing[field] !== undefined) {
      candidate[field] = existing[field];
    }
  }
}

function buildValidationView(
  table: ScopedEntityKey,
  candidate: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  context: PlanningCapabilities
) {
  const visible = { ...candidate };
  for (const field of listHiddenFields(table, context, existing)) delete visible[field];
  return visible;
}

function assertRequired(table: ScopedEntityKey, candidate: Record<string, unknown>) {
  const missing = requiredFields[table].filter((field) => !Object.hasOwn(candidate, field));
  if (missing.length) {
    throw new EntityWriteError(`Missing required field(s): ${missing.join(', ')}.`);
  }
}

export interface EntityWriteOptions {
  lookup: ValidationDataLookup;
  hasOtherBuiltinClient(companyId: string, clientId: string): boolean;
}

/** Prepare one complete entity row for a typed write against the current transaction projection. */
export async function prepareEntityWrite<K extends ScopedEntityKey>(
  table: K,
  row: Record<string, unknown>,
  stored: AppData[K][number] | undefined,
  state: AppData,
  context: PlanningCapabilities,
  options: EntityWriteOptions
): Promise<AppData[K][number]> {
  const existing = stored && asRecord(stored);
  if (typeof row.id !== 'string' || !ENTITY_ID_PATTERN.test(row.id)) {
    throw new EntityWriteError(
      'id must be 1–128 URL-safe characters, begin with a letter or number, and contain only letters, numbers, dot, underscore, tilde, colon or hyphen.'
    );
  }
  if (typeof row.companyId !== 'string' || row.companyId.length === 0) {
    throw new EntityWriteError('A string companyId is required.');
  }
  if (existing && existing.companyId !== row.companyId) {
    throw new EntityWriteError('Not found.', 404);
  }
  const hidden = listHiddenFields(table, context, existing);
  for (const [field, value] of Object.entries(row)) {
    if (value !== undefined || hidden.includes(field)) continue;
    reject(field, 'cannot be undefined');
  }
  let candidate = { ...row };
  pinHiddenFields(table, candidate, existing, context);
  assertRequired(table, candidate);
  if (table === 'resources' && existing) assertResourceKind(candidate, existing);
  let validated: AppData[K][number];
  try {
    const visible = buildValidationView(table, candidate, existing, context);
    validated = await validateRow(table, visible);
    // The validated row keeps what the caller cannot see as stored; `candidate` is its field view.
    for (const field of hidden) {
      if (Object.hasOwn(candidate, field)) asRecord(validated)[field] = candidate[field];
    }
    candidate = asRecord(validated);
  } catch (error) {
    if (error instanceof errors.E_VALIDATION_ERROR) {
      const first = error.messages[0];
      if (typeof first?.message === 'string') {
        throw new EntityWriteError(
          first.message,
          400,
          undefined,
          first.rule === 'resource_avatar_url_invalid' ? first.rule : undefined
        );
      }
    }
    throw error;
  }
  assertManagedFields(table, row, candidate, existing);
  if (table === 'resources') {
    assertResourceFields(row, candidate);
  }
  if (table === 'clients' || table === 'projects') {
    if (context.canSeePrivateNames && !hasUsablePrivateCodeName(candidate)) {
      throw new EntityWriteError('A private client or project requires a code name.');
    }
  }
  if (
    table === 'closures' &&
    (typeof candidate.name !== 'string' || cleanText(candidate.name).length === 0)
  ) {
    throw new EntityWriteError('Closure name is required.');
  }
  for (const field of ['name', 'role', 'codeName', 'note', 'task'] as const) {
    if (typeof candidate[field] === 'string') {
      candidate[field] = cleanText(candidate[field] as string, { multiline: field === 'note' });
    }
  }
  if (table === 'resources' && candidate.avatarUrl !== null && candidate.avatarUrl !== undefined) {
    candidate.avatarUrl = parseResourceAvatarUrl(candidate.avatarUrl);
  }
  normalizeValidWrite({
    table,
    candidate,
    restrictedPrivateRow: isPrivateRowRestricted(table, context, existing),
  });
  try {
    // `table` is the key `validated` and `stored` were read for; the compiler cannot relate a
    // generic key to the table-keyed union, so name the pairing once here.
    const write = { table, row: validated, existing: stored } as EntityWrite;
    assertEntityDomain(write, state, options.lookup, options.hasOtherBuiltinClient);
  } catch (error) {
    if (error instanceof EntityWriteError) throw error;
    if (error instanceof DomainError) {
      throw new EntityWriteError(error.message, 400, undefined, error.code);
    }
    throw error;
  }
  fillNullableFields(table, candidate);
  const now = createServerRevision(stored?.updatedAt);
  return { ...validated, createdAt: stored?.createdAt ?? now, updatedAt: now };
}
