import {
  APP_DATA_KEYS,
  CAPACITY_OVERVIEW_ACCESS_VALUES,
  externalCapacityDefaults,
  placeholderCapacityDefaults,
  type AppData,
  type AppDataKey,
} from '@capacitylens/shared/types/entities'
import { NEUTRAL_COLOR } from '@capacitylens/shared/lib/color'
import {
  INTERNAL_CLIENT_COLOR,
  INTERNAL_CLIENT_NAME,
  internalClientIdFor,
} from '@capacitylens/shared/data/internalClient'
import type { ValidationDataLookup } from '@capacitylens/shared/domain/mutations'
import { cleanText } from '@capacitylens/shared/lib/strings'
import { hasUsablePrivateCodeName } from '@capacitylens/shared/domain/privateNames'
import { DomainError } from '@capacitylens/shared/domain/errors'
import { parseResourceAvatarUrl } from '@capacitylens/shared/domain/resourceAvatarUrl'
import { fillNullableFields } from '@capacitylens/shared/types/nullableFields'
import { validateEntityRow, requiredFields } from '#validators/entities/index'
import { assertEntityDomain } from '#services/batch/entity_validation/domain'
import { normalizeValidWrite } from '#services/batch/entity_validation/normalization'
import { BatchRequestError } from '#services/batch/errors'
import { createServerRevision } from '#services/batch/revision'
import type { BatchCapabilities } from '#services/batch/data_policy'

export const TABLE_NAMES = {
  accounts: 'accounts',
  disciplines: 'disciplines',
  resources: 'resources',
  clients: 'clients',
  projects: 'projects',
  phases: 'phases',
  activities: 'activities',
  allocations: 'allocations',
  timeOff: 'time_off',
  closures: 'closures',
} as const satisfies Record<AppDataKey, import('#services/state_repository').ProductTable>

export const isTable = (value: string): value is AppDataKey =>
  APP_DATA_KEYS.includes(value as AppDataKey)
export const isScoped = (table: AppDataKey) => table !== 'accounts'
export const isLifecycle = (table: AppDataKey) =>
  ['clients', 'projects', 'resources', 'activities'].includes(table)

const IMMUTABLE_ACCOUNT_FIELDS = ['language', 'weekStartsOn', 'timezone'] as const
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/

function reject(field: string, reason: string): never {
  throw new BatchRequestError(`${field} ${reason}.`)
}

function pinHiddenFields(
  table: AppDataKey,
  candidate: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  context: BatchCapabilities
) {
  if (table === 'timeOff' && !context.canSeeTimeOffNote) {
    if (typeof existing?.note === 'string') candidate.note = existing.note
    else delete candidate.note
  }
  if ((table === 'clients' || table === 'projects') && !context.canSeePrivateNames) {
    if (existing?.isPrivate === true) {
      candidate.name = existing.name
      candidate.isPrivate = true
      if (typeof existing.codeName === 'string') candidate.codeName = existing.codeName
      else delete candidate.codeName
    } else {
      delete candidate.isPrivate
      delete candidate.codeName
    }
  }
  if (table === 'accounts' && context.role !== 'owner' && context.role !== 'admin') {
    if (CAPACITY_OVERVIEW_ACCESS_VALUES.includes(existing?.capacityOverviewAccess as never))
      candidate.capacityOverviewAccess = existing?.capacityOverviewAccess
    else delete candidate.capacityOverviewAccess
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
  )
    throw new BatchRequestError('A person or external company name is required.')
  if (kind === 'person') {
    if (requested.projectId !== undefined && requested.projectId !== null)
      reject('projectId', 'is only used by placeholders')
    const first = candidate.firstAvailableDate
    const last = candidate.lastAvailableDate
    if (typeof first === 'string' && typeof last === 'string' && first > last)
      reject('firstAvailableDate', 'cannot be after lastAvailableDate')
    const days = candidate.workingDays
    const halves = candidate.halfDays
    if (Array.isArray(days) && Array.isArray(halves) && halves.some((day) => !days.includes(day)))
      reject('halfDays', 'must be included in workingDays')
    return
  }
  if (kind !== 'placeholder' && kind !== 'external') return
  const defaults = kind === 'external' ? externalCapacityDefaults() : placeholderCapacityDefaults()
  for (const field of ['workingDays', 'halfDays'] as const)
    if (
      Object.hasOwn(requested, field) &&
      JSON.stringify(candidate[field]) !== JSON.stringify(defaults[field])
    )
      reject(field, "must match this resource kind's defaults")
  if (kind === 'placeholder') {
    if (Object.hasOwn(requested, 'engagement') && candidate.engagement !== 'studio')
      reject('engagement', 'must be studio for a placeholder')
  } else {
    const externalDefaults = externalCapacityDefaults()
    for (const field of ['employmentType', 'engagement', 'workingHoursPerDay'] as const)
      if (Object.hasOwn(requested, field) && candidate[field] !== externalDefaults[field])
        reject(field, "must match an external resource's defaults")
    if (Object.hasOwn(requested, 'color') && candidate.color !== NEUTRAL_COLOR)
      reject('color', 'must be the external resource colour')
    if (
      (requested.disciplineId !== undefined && requested.disciplineId !== null) ||
      (requested.projectId !== undefined && requested.projectId !== null)
    )
      reject('disciplineId', 'is not used by external resources')
  }
  for (const field of ['firstAvailableDate', 'lastAvailableDate'] as const)
    if (requested[field] !== undefined && requested[field] !== null)
      reject(field, 'is only used by people')
  if (Object.hasOwn(requested, 'avatarUrl')) {
    if (requested.avatarUrl !== null && requested.avatarUrl !== undefined)
      throw new BatchRequestError(
        'Only a person can have an avatar URL.',
        400,
        undefined,
        'resource_avatar_url_forbidden'
      )
  }
}

function assertResourceKind(candidate: Record<string, unknown>, existing: Record<string, unknown>) {
  if (!['person', 'placeholder', 'external'].includes(existing.kind as string))
    throw new BatchRequestError(
      'The stored resource kind is invalid and must be repaired by import.',
      400,
      undefined,
      'resource_kind_immutable'
    )
  if (candidate.kind !== existing.kind)
    throw new BatchRequestError(
      'A resource’s kind cannot change after creation.',
      400,
      undefined,
      'resource_kind_immutable'
    )
}

function assertManagedFields(
  table: AppDataKey,
  requested: Record<string, unknown>,
  candidate: Record<string, unknown>,
  existing: Record<string, unknown> | undefined
) {
  if (isLifecycle(table)) {
    for (const field of ['archivedAt', 'deletedAt'] as const) {
      if (Object.hasOwn(requested, field) && requested[field] !== (existing?.[field] ?? null))
        throw new BatchRequestError(`${field} is managed by its lifecycle action.`)
      candidate[field] = existing?.[field] ?? null
    }
  }
  if (table === 'allocations' && existing) {
    if (Object.hasOwn(requested, 'seriesId') && requested.seriesId !== existing.seriesId)
      throw new BatchRequestError('seriesId is fixed after creation.')
    candidate.seriesId = existing.seriesId ?? null
  }
  if (table === 'accounts' && existing) {
    assertFrozenAccountFields(requested, candidate, existing)
    if (!Object.hasOwn(requested, 'workingDays') && existing.workingDays !== undefined)
      candidate.workingDays = existing.workingDays
  }
  if (table === 'resources' && existing && candidate.kind === 'person') {
    for (const field of ['firstAvailableDate', 'lastAvailableDate'] as const)
      if (!Object.hasOwn(requested, field) && typeof existing[field] === 'string')
        candidate[field] = existing[field]
  }
}

/** Keep the dedicated company PATCH and batch write paths on one frozen-field policy. */
export function assertFrozenAccountFields(
  requested: Record<string, unknown>,
  candidate: Record<string, unknown>,
  existing: Record<string, unknown>
) {
  for (const field of IMMUTABLE_ACCOUNT_FIELDS) {
    if (
      Object.hasOwn(requested, field) &&
      existing[field] !== undefined &&
      existing[field] !== null &&
      requested[field] !== existing[field]
    )
      throw new BatchRequestError(
        'Language, week start and time zone are set when the company is created and cannot be changed.',
        409
      )
    if (!Object.hasOwn(requested, field) && existing[field] !== undefined)
      candidate[field] = existing[field]
  }
}

function validationView(
  table: AppDataKey,
  candidate: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  context: BatchCapabilities
) {
  const visible = { ...candidate }
  if (table === 'timeOff' && !context.canSeeTimeOffNote) delete visible.note
  if ((table === 'clients' || table === 'projects') && !context.canSeePrivateNames) {
    delete visible.isPrivate
    delete visible.codeName
    if (existing?.isPrivate === true) delete visible.name
  }
  if (table === 'accounts' && context.role !== 'owner' && context.role !== 'admin')
    delete visible.capacityOverviewAccess
  return visible
}

function assertRequired(table: AppDataKey, candidate: Record<string, unknown>) {
  const missing = requiredFields[table].filter((field) => !Object.hasOwn(candidate, field))
  if (missing.length)
    throw new BatchRequestError(`Missing required field(s): ${missing.join(', ')}.`)
  if (table === 'resources' && candidate.halfDays === undefined) candidate.halfDays = []
  if (table === 'resources' && candidate.engagement === undefined) candidate.engagement = 'studio'
}

export interface EntityWriteOptions {
  lookup: ValidationDataLookup
  hasOtherBuiltinClient(accountId: string, clientId: string, excludedId?: string): boolean
  /** Only the service may identify the deterministic Internal row displaced by a client PUT. */
  generatedBuiltinReplacementId?: string
}

function resolveGeneratedBuiltinReplacement(
  table: AppDataKey,
  row: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  options: EntityWriteOptions
): string | undefined {
  const generatedId = options.generatedBuiltinReplacementId
  if (generatedId === undefined) return undefined
  const accountId = row.accountId
  const generated = options.lookup.row('clients', generatedId)
  if (
    table !== 'clients' ||
    row.builtin !== true ||
    existing !== undefined ||
    typeof accountId !== 'string' ||
    generatedId !== internalClientIdFor(accountId) ||
    row.id === generatedId ||
    options.lookup.row('clients', String(row.id)) !== undefined ||
    generated?.accountId !== accountId ||
    generated.builtin !== true ||
    generated.name !== INTERNAL_CLIENT_NAME ||
    generated.color !== INTERNAL_CLIENT_COLOR
  )
    throw new BatchRequestError('The built-in Internal client is managed by the server.')
  return generatedId
}

/** Prepare a strict full-row PUT against the current transaction projection. */
export async function prepareEntityWrite(
  table: AppDataKey,
  row: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  state: AppData,
  context: BatchCapabilities,
  options: EntityWriteOptions
): Promise<Record<string, unknown>> {
  if (typeof row.id !== 'string' || !ID_PATTERN.test(row.id))
    throw new BatchRequestError(
      'id must be 1–128 URL-safe characters, begin with a letter or number, and contain only letters, numbers, dot, underscore, tilde or hyphen.'
    )
  if (isScoped(table) && (typeof row.accountId !== 'string' || row.accountId.length === 0))
    throw new BatchRequestError('A string accountId is required.')
  if (existing && isScoped(table) && existing.accountId !== row.accountId)
    throw new BatchRequestError('Not found.', 404)
  for (const [field, value] of Object.entries(row)) {
    if (value !== undefined) continue
    if (table === 'timeOff' && field === 'note' && !context.canSeeTimeOffNote) continue
    if (
      (table === 'clients' || table === 'projects') &&
      !context.canSeePrivateNames &&
      (field === 'isPrivate' ||
        field === 'codeName' ||
        (field === 'name' && existing?.isPrivate === true))
    )
      continue
    if (
      table === 'accounts' &&
      field === 'capacityOverviewAccess' &&
      context.role !== 'owner' &&
      context.role !== 'admin'
    )
      continue
    reject(field, 'cannot be undefined')
  }
  let candidate = { ...row }
  pinHiddenFields(table, candidate, existing, context)
  assertRequired(table, candidate)
  if (table === 'resources' && existing) assertResourceKind(candidate, existing)
  try {
    const visible = validationView(table, candidate, existing, context)
    const validated = await validateEntityRow(table, visible)
    const preserved: Record<string, unknown> = {}
    if (table === 'timeOff' && !context.canSeeTimeOffNote && Object.hasOwn(candidate, 'note'))
      preserved.note = candidate.note
    if ((table === 'clients' || table === 'projects') && !context.canSeePrivateNames) {
      for (const field of ['isPrivate', 'codeName'] as const)
        if (Object.hasOwn(candidate, field)) preserved[field] = candidate[field]
      if (existing?.isPrivate === true && Object.hasOwn(candidate, 'name'))
        preserved.name = candidate.name
    }
    if (
      table === 'accounts' &&
      context.role !== 'owner' &&
      context.role !== 'admin' &&
      Object.hasOwn(candidate, 'capacityOverviewAccess')
    )
      preserved.capacityOverviewAccess = candidate.capacityOverviewAccess
    candidate = { ...validated, ...preserved }
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'E_VALIDATION_ERROR' &&
      'messages' in error &&
      Array.isArray(error.messages)
    ) {
      const first = error.messages[0]
      if (typeof first?.message === 'string')
        throw new BatchRequestError(
          first.message,
          400,
          undefined,
          first.rule === 'resource_avatar_url_invalid' ? first.rule : undefined
        )
    }
    throw error
  }
  assertManagedFields(table, row, candidate, existing)
  if (table === 'resources') {
    assertResourceFields(row, candidate)
  }
  if (table === 'clients' || table === 'projects') {
    if (context.canSeePrivateNames && !hasUsablePrivateCodeName(candidate))
      throw new BatchRequestError('A private client or project requires a code name.')
  }
  if (
    table === 'closures' &&
    (typeof candidate.name !== 'string' || cleanText(candidate.name).length === 0)
  )
    throw new BatchRequestError('Closure name is required.')
  if (
    table === 'accounts' &&
    (typeof candidate.name !== 'string' || cleanText(candidate.name).length === 0)
  )
    throw new BatchRequestError('Company name is required.')
  for (const field of ['name', 'role', 'codeName', 'note', 'task'] as const)
    if (typeof candidate[field] === 'string')
      candidate[field] = cleanText(candidate[field] as string, { multiline: field === 'note' })
  if (table === 'resources' && candidate.avatarUrl !== null && candidate.avatarUrl !== undefined)
    candidate.avatarUrl = parseResourceAvatarUrl(candidate.avatarUrl)
  normalizeValidWrite({
    table,
    candidate,
    requested: row,
    existing,
    canSeePrivateNames: context.canSeePrivateNames,
  })
  const replacementId = resolveGeneratedBuiltinReplacement(table, candidate, existing, options)
  try {
    assertEntityDomain(
      table,
      candidate,
      existing,
      state,
      options.lookup,
      options.hasOtherBuiltinClient,
      replacementId
    )
  } catch (error) {
    if (error instanceof BatchRequestError) throw error
    if (error instanceof DomainError)
      throw new BatchRequestError(error.message, 400, undefined, error.code)
    throw error
  }
  fillNullableFields(table, candidate)
  const now = createServerRevision(existing?.updatedAt)
  return { ...candidate, createdAt: existing?.createdAt ?? now, updatedAt: now }
}
