import { errors } from '@vinejs/vine'
import {
  RESOURCE_KINDS,
  buildExternalCapacityDefaults,
  type Company,
  type AppData,
  type ScopedEntityKey,
  type Weekday,
} from '@capacitylens/shared/types/entities'
import { NEUTRAL_COLOR } from '@capacitylens/shared/lib/color'
import {
  parseFixedWorkingPattern,
  areHalfDaysWithinWorkingDays,
  isSameWeekdays,
} from '@capacitylens/shared/domain/resourceWorkingPattern'
import { cleanText } from '@capacitylens/shared/lib/strings'
import { hasUsablePrivateCodeName } from '@capacitylens/shared/domain/privateNames'
import { DomainError } from '@capacitylens/shared/domain/errors'
import { parseResourceAvatarUrl } from '@capacitylens/shared/domain/resourceAvatarUrl'
import { fillNullableFields } from '@capacitylens/shared/types/nullableFields'
import { isLifecycleEntityKey } from '@capacitylens/shared/domain/lifecycle'
import { requiredFields } from '@capacitylens/shared/types/entityFields'
import { asRecord } from '#services/planning/writer'
import { isEntityId } from '@capacitylens/shared/types/entityFieldRules'
import { assertEntityDomain, type EntityWrite } from '#services/planning/entity_validation/domain'
import { normalizeValidWrite } from '#services/planning/entity_validation/normalization'
import {
  listHiddenFields,
  getRestriction,
  isPrivateRowRestricted,
} from '#services/planning/restricted_fields'
import { createServerRevision } from '#services/planning/server_timestamp'
import type { PlanningAccessGrant } from '#services/planning/access_grant'
import PlanningAuthorizationException from '#exceptions/planning_authorization_exception'
import EntityWriteException from '#exceptions/entity_write_exception'
import ClosureNameRequiredException from '#exceptions/closure_name_required_exception'
import EntityNotFoundException from '#exceptions/entity_not_found_exception'
import FrozenCompanyFieldException from '#exceptions/frozen_company_field_exception'
import ResourceAvatarUrlForbiddenException from '#exceptions/resource_avatar_url_forbidden_exception'
import ResourceAvatarUrlInvalidException from '#exceptions/resource_avatar_url_invalid_exception'
import ResourceKindImmutableException from '#exceptions/resource_kind_immutable_exception'
import { toDomainRuleException } from '#services/planning/domain_rule_exceptions'

// Widened so a stored value of unknown type can be checked against the known kinds.
const resourceKinds: readonly unknown[] = RESOURCE_KINDS

/** Server-owned values every new row of a table starts with, before validation. */
const CREATE_DEFAULTS: Partial<Record<ScopedEntityKey, Record<string, unknown>>> = {
  clients: { builtin: null },
  allocations: { seriesId: null },
  resources: { avatarUrl: null, halfDays: [], engagement: 'studio' },
}
/** Fields a new row may not supply: lifecycle state and the Internal client flag. */
const SERVER_SET_ON_CREATE = new Set(['archivedAt', 'builtin'])

/** Applies a new row's server-owned defaults; lifecycle tables start active. */
export function applyCreateDefaults(table: ScopedEntityKey, candidate: Record<string, unknown>) {
  const defaults: Record<string, unknown> = {
    ...(isLifecycleEntityKey(table) ? { archivedAt: null } : {}),
    ...CREATE_DEFAULTS[table],
  }
  for (const [field, value] of Object.entries(defaults)) {
    if (SERVER_SET_ON_CREATE.has(field)) candidate[field] = value
    else candidate[field] ??= Array.isArray(value) ? [...value] : value
  }
}

const isEmptyValue = (value: unknown) => value === undefined || value === null || value === false

/** Refuses a write that names a restricted field the caller may not change. */
export function assertMayWriteRestrictedFields(
  table: ScopedEntityKey,
  fields: Record<string, unknown>,
  accessGrant: PlanningAccessGrant,
  mode: 'create' | 'update'
) {
  const rule = getRestriction(table, accessGrant)
  if (!rule) return
  const named = rule.fields.some(
    (field) =>
      Object.hasOwn(fields, field) &&
      !(mode === 'create' && rule.emptyAllowedOnCreate && isEmptyValue(fields[field]))
  )
  if (named) throw new PlanningAuthorizationException(rule.refusal)
}

const IMMUTABLE_COMPANY_FIELDS = ['language', 'weekStartsOn', 'timezone'] as const

function reject(field: string, reason: string): never {
  throw new EntityWriteException(`${field} ${reason}.`)
}

/** Keeps a restricted caller's write from changing what it cannot see: stored values win. */
function pinHiddenFields(
  table: ScopedEntityKey,
  candidate: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  accessGrant: PlanningAccessGrant
) {
  const rule = getRestriction(table, accessGrant)
  if (!rule) return
  const privateRow = existing?.isPrivate === true
  const keepsStored = rule.privateRowFields.length === 0 || privateRow
  for (const field of rule.fields) {
    const stored = existing?.[field]
    if (keepsStored && stored !== null && stored !== undefined) candidate[field] = stored
    else delete candidate[field]
  }
  if (privateRow) {
    for (const field of rule.privateRowFields) candidate[field] = existing[field]
  }
}

function assertResourceFields(
  requested: Record<string, unknown>,
  candidate: Record<string, unknown>
) {
  const kind = candidate.kind
  if (
    kind !== 'placeholder' &&
    (typeof candidate.name !== 'string' || cleanText(candidate.name).length === 0)
  ) {
    throw new EntityWriteException('A person or external company name is required.')
  }
  if (kind === 'person') {
    if (requested.projectId !== undefined && requested.projectId !== null) {
      reject('projectId', 'is only used by placeholders')
    }
    const first = candidate.firstAvailableDate
    const last = candidate.lastAvailableDate
    if (typeof first === 'string' && typeof last === 'string' && first > last) {
      reject('firstAvailableDate', 'cannot be after lastAvailableDate')
    }
    const days = candidate.workingDays
    const halves = candidate.halfDays
    if (
      Array.isArray(days) &&
      Array.isArray(halves) &&
      !areHalfDaysWithinWorkingDays(days, halves)
    ) {
      reject('halfDays', 'must be included in workingDays')
    }
    return
  }
  if (kind !== 'placeholder' && kind !== 'external') return
  const pattern = parseFixedWorkingPattern(kind)
  for (const field of ['workingDays', 'halfDays'] as const) {
    if (
      pattern &&
      Object.hasOwn(requested, field) &&
      !isSameWeekdays(candidate[field], pattern[field])
    ) {
      reject(field, "must match this resource kind's defaults")
    }
  }
  if (kind === 'placeholder') {
    if (Object.hasOwn(requested, 'engagement') && candidate.engagement !== 'studio') {
      reject('engagement', 'must be studio for a placeholder')
    }
  } else {
    const externalDefaults = buildExternalCapacityDefaults()
    for (const field of ['employmentType', 'engagement', 'workingHoursPerDay'] as const) {
      if (Object.hasOwn(requested, field) && candidate[field] !== externalDefaults[field]) {
        reject(field, "must match an external resource's defaults")
      }
    }
    if (Object.hasOwn(requested, 'color') && candidate.color !== NEUTRAL_COLOR) {
      reject('color', 'must be the external resource colour')
    }
    for (const field of ['disciplineId', 'projectId'] as const) {
      if (requested[field] != null) {
        reject(field, 'is not used by external resources')
      }
    }
  }
  for (const field of ['firstAvailableDate', 'lastAvailableDate'] as const) {
    if (requested[field] !== undefined && requested[field] !== null) {
      reject(field, 'is only used by people')
    }
  }
  if (Object.hasOwn(requested, 'avatarUrl')) {
    if (requested.avatarUrl !== null && requested.avatarUrl !== undefined) {
      throw new ResourceAvatarUrlForbiddenException()
    }
  }
}

function assertResourceKind(candidate: Record<string, unknown>, existing: Record<string, unknown>) {
  if (!resourceKinds.includes(existing.kind)) {
    throw new ResourceKindImmutableException(
      'The stored resource kind is invalid and must be repaired by import.'
    )
  }
  if (candidate.kind !== existing.kind) {
    throw new ResourceKindImmutableException('A resource’s kind cannot change after creation.')
  }
}

function assertManagedFields(
  table: ScopedEntityKey,
  requested: Record<string, unknown>,
  candidate: Record<string, unknown>,
  existing: Record<string, unknown> | undefined
) {
  if (isLifecycleEntityKey(table)) {
    if (
      Object.hasOwn(requested, 'archivedAt') &&
      requested.archivedAt !== (existing?.archivedAt ?? null)
    ) {
      throw new EntityWriteException('archivedAt is managed by its lifecycle action.')
    }
    candidate.archivedAt = existing?.archivedAt ?? null
  }
  if (table === 'allocations' && existing) {
    if (Object.hasOwn(requested, 'seriesId') && requested.seriesId !== existing.seriesId) {
      throw new EntityWriteException('seriesId is fixed after creation.')
    }
    candidate.seriesId = existing.seriesId ?? null
  }
  if (table === 'resources' && existing && candidate.kind === 'person') {
    for (const field of ['firstAvailableDate', 'lastAvailableDate'] as const) {
      if (!Object.hasOwn(requested, field) && typeof existing[field] === 'string') {
        candidate[field] = existing[field]
      }
    }
  }
}

/** Keep typed settings and entity writes on one set of frozen-field rules. */
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
      throw new FrozenCompanyFieldException()
    }
    if (!Object.hasOwn(requested, field) && existing[field] !== undefined) {
      candidate[field] = existing[field]
    }
  }
}

function buildValidationView(
  table: ScopedEntityKey,
  candidate: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  accessGrant: PlanningAccessGrant
) {
  const visible = { ...candidate }
  for (const field of listHiddenFields(table, accessGrant, existing)) delete visible[field]
  return visible
}

function assertRequired(table: ScopedEntityKey, candidate: Record<string, unknown>) {
  const missing = requiredFields[table].filter((field) => !Object.hasOwn(candidate, field))
  if (missing.length) {
    throw new EntityWriteException(`Missing required field(s): ${missing.join(', ')}.`)
  }
}

export interface EntityWriteOptions {
  /** The company's canonical working-day set, read once by the caller. */
  companyWorkingDays: Weekday[]
}

/** One entity row checked before field validation: the row, its hidden fields and the field view. */
export interface EntityWriteDraft {
  candidate: Record<string, unknown>
  hidden: readonly string[]
  /** What field validation reads: the row without the fields the caller cannot see. */
  visible: Record<string, unknown>
}

/**
 * Checks one complete entity row for a typed write before field validation, against the current
 * transaction projection. `RowValidationService.validateRow` then checks the draft's `visible`
 * row and `completeEntityWrite` finishes it.
 */
export function beginEntityWrite<K extends ScopedEntityKey>(
  table: K,
  row: Record<string, unknown>,
  stored: AppData[K][number] | undefined,
  accessGrant: PlanningAccessGrant
): EntityWriteDraft {
  const existing = stored && asRecord(stored)
  if (!isEntityId(row.id)) {
    throw new EntityWriteException(
      'id must be 1–128 URL-safe characters, begin with a letter or number, and contain only letters, numbers, dot, underscore, tilde, colon or hyphen.'
    )
  }
  if (typeof row.companyId !== 'string' || row.companyId.length === 0) {
    throw new EntityWriteException('A string companyId is required.')
  }
  if (existing && existing.companyId !== row.companyId) {
    throw new EntityNotFoundException('Not found.')
  }
  const hidden = listHiddenFields(table, accessGrant, existing)
  for (const [field, value] of Object.entries(row)) {
    if (value !== undefined || hidden.includes(field)) continue
    reject(field, 'cannot be undefined')
  }
  const candidate = { ...row }
  pinHiddenFields(table, candidate, existing, accessGrant)
  assertRequired(table, candidate)
  if (table === 'resources' && existing) assertResourceKind(candidate, existing)
  return {
    candidate,
    hidden,
    visible: buildValidationView(table, candidate, existing, accessGrant),
  }
}

/** The entity write's refusal for a field validation error; any other error is returned as it is. */
export function toEntityWriteError(error: unknown): unknown {
  if (error instanceof errors.E_VALIDATION_ERROR) {
    const first = error.messages[0]
    if (typeof first?.message === 'string') {
      return first.rule === 'E_RESOURCE_AVATAR_URL_INVALID'
        ? new ResourceAvatarUrlInvalidException(first.message)
        : new EntityWriteException(first.message)
    }
  }
  return error
}

/** Completes one entity row for a typed write from its draft and the validated field view. */
export function completeEntityWrite<K extends ScopedEntityKey>(
  table: K,
  row: Record<string, unknown>,
  stored: AppData[K][number] | undefined,
  state: AppData,
  accessGrant: PlanningAccessGrant,
  options: EntityWriteOptions,
  draft: EntityWriteDraft,
  validated: AppData[K][number]
): AppData[K][number] {
  const existing = stored && asRecord(stored)
  // The validated row keeps what the caller cannot see as stored; `candidate` is its field view.
  for (const field of draft.hidden) {
    if (Object.hasOwn(draft.candidate, field)) asRecord(validated)[field] = draft.candidate[field]
  }
  const candidate = asRecord(validated)
  assertManagedFields(table, row, candidate, existing)
  if (table === 'resources') {
    assertResourceFields(row, candidate)
  }
  if (table === 'clients' || table === 'projects') {
    if (accessGrant.canSeePrivateNames && !hasUsablePrivateCodeName(candidate)) {
      throw new EntityWriteException('A private client or project requires a code name.')
    }
  }
  if (
    table === 'closures' &&
    (typeof candidate.name !== 'string' || cleanText(candidate.name).length === 0)
  ) {
    throw new ClosureNameRequiredException('Closure name is required.')
  }
  for (const field of ['name', 'jobTitle', 'codeName', 'note', 'task'] as const) {
    if (typeof candidate[field] === 'string') {
      candidate[field] = cleanText(candidate[field] as string, { multiline: field === 'note' })
    }
  }
  if (table === 'resources' && candidate.avatarUrl !== null && candidate.avatarUrl !== undefined) {
    candidate.avatarUrl = parseResourceAvatarUrl(candidate.avatarUrl)
  }
  normalizeValidWrite({
    table,
    candidate,
    restrictedPrivateRow: isPrivateRowRestricted(table, accessGrant, existing),
  })
  try {
    // `table` is the key `validated` and `stored` were read for; the compiler cannot relate a
    // generic key to the table-keyed union, so name the pairing once here.
    const write = { table, row: validated, existing: stored } as EntityWrite
    assertEntityDomain(write, state, options.companyWorkingDays)
  } catch (error) {
    if (error instanceof EntityWriteException) throw error
    if (error instanceof DomainError) {
      throw toDomainRuleException(error)
    }
    throw error
  }
  fillNullableFields(table, candidate)
  const now = createServerRevision(stored?.updatedAt)
  return { ...validated, createdAt: stored?.createdAt ?? now, updatedAt: now }
}
